import { MapboxOverlay as DeckOverlay } from '@deck.gl/mapbox';
import { COGLayer } from '@developmentseed/deck.gl-geotiff';
import { DecoderPool } from '@developmentseed/geotiff';

import Previewer from './previewer';
import type Source from '../sources/source';

// Deck.gl-based previewer for Cloud Optimized GeoTIFF (COG) sources
// Can warp COGs on the fly; supports projections other than Web Mercator
// NOTE: can't be built currently due to a bug; see:
// https://github.com/OpenGeoMetadata/ogm-viewer/issues/100
export default class DeckCogPreviewer extends Previewer {
  protected map: maplibregl.Map;
  protected deckOverlay: DeckOverlay;
  protected layerId: string | undefined = undefined;

  private bounds: maplibregl.LngLatBoundsLike | undefined = undefined;

  constructor(source: Source, map: maplibregl.Map) {
    super(source);
    this.map = map;
    this.deckOverlay = this.getDeckOverlay();
  }

  async preview(): Promise<void> {
    if (!this.layerId) {
      const layer = this.createLayer();
      console.debug('Created COG preview layer', layer.id);
      this.layerId = layer.id;
      this.deckOverlay.setProps({ layers: [layer] });
    }
  }

  async clearPreview() {
    if (this.layerId) {
      console.debug('Clearing COG preview layer', this.layerId);
      this.deckOverlay.setProps({ layers: [] });
      this.layerId = undefined;
    }
  }

  protected getSourceId(): string {
    return `${this.source.id}-cog`;
  }

  protected createLayer(): COGLayer {
    return new COGLayer({
      id: this.getSourceId(),
      geotiff: this.source.getSourceUrl(),
      onGeoTIFFLoad: (data, options) => {
        console.debug('COG loaded', data, options);
        const { west, south, east, north } = options.geographicBounds;
        this.bounds = [
          [west, south],
          [east, north],
        ];
      },
      parameters: { depthCompare: 'always', cullMode: 'back' },
      // Disable the web worker decoder pool; this appears to cause errors because
      // it can't find /worker.js?
      // See: https://developmentseed.org/deck.gl-raster/api/geotiff/type-aliases/DecoderPoolOptions/
      // See also: https://github.com/developmentseed/deck.gl-raster/issues/364
      pool: new DecoderPool({
        createWorker: undefined,
      }),
    });
  }

  async getBounds() {
    return this.bounds;
  }

  // Get the shared deck.gl overlay used to render this previewer
  protected getDeckOverlay(): DeckOverlay {
    // No built-in way to query existing controls...
    const overlay = this.map._controls.find(control => control instanceof DeckOverlay);
    if (overlay) {
      console.debug('Deck.gl overlay exists; skipping creation', overlay);
      return overlay;
    }
    return this.createDeckOverlay();
  }

  // Create a deck.gl overlay and add it to the map
  protected createDeckOverlay(): DeckOverlay {
    const overlay = new DeckOverlay({ interleaved: true });
    this.map.addControl(overlay);
    console.debug('Deck.gl overlay created', overlay);
    return overlay;
  }
}
