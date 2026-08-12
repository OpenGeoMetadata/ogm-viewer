import { MapboxOverlay as DeckOverlay } from '@deck.gl/mapbox';
import { COGLayer } from '@developmentseed/deck.gl-geotiff';
import { DecoderPool, type GeoTIFF } from '@developmentseed/geotiff';
import type { AddLayerObject, LngLatBoundsLike } from 'maplibre-gl';

import MapPreviewer from './map';
import type CogResource from '../resources/cog';
import { openGeoTIFF } from '../geotiff';
import { isLayerDrawn, type LayerState, type PreviewStyleLayer } from '../layers';
import type { MapLibreStyle } from '../themes/maplibre';

// How long to wait for deck.gl to read the GeoTIFF's header when the record declared no bounding box
// of its own. A COG that never answers must not leave the map spinning with nowhere to point.
const HEADER_TIMEOUT = 10_000;

// Draws a Cloud Optimized GeoTIFF with deck.gl, which warps it on the fly - so unlike CogPreviewer
// and the maplibre-cog-protocol it wraps, this one is not limited to COGs already in Web Mercator.
//
// Not a style layer: deck.gl draws through an overlay it adds to the map as a control, so there is
// nothing for MapLibre to style and its own layer registry never learns the id. That is why both the
// style layer type and applyStyleLayerState below are overridden - see MapPreviewer.
export default class DeckCogPreviewer extends MapPreviewer {
  declare protected resource: CogResource;

  // deck.gl's TileLayer, which COGLayer draws through, has no getBoundingVolume for a globe view and
  // logs an error every frame it tries to cull tiles against one. The COG still draws, but the
  // console fills up, so this preview asks for the flat map it can actually be culled in.
  readonly projection = 'mercator' as const;

  // The overlay deck.gl draws into, shared with any other deck previewer on the same map
  protected deckOverlay: DeckOverlay | undefined;

  // Built once and reused: recreating it on every opacity change would throw away the decoder
  // workers along with it, and this layer is rebuilt on each of those.
  protected decoderPool: DecoderPool | undefined;

  // What the user has asked for, held because deck.gl takes visibility and opacity as layer props,
  // so changing either means handing it the layer again with the rest of the props unchanged.
  // Distinct from MapPreviewer's own layerState memo, which is keyed by layer and private to it.
  protected drawnState: LayerState | undefined;

  // Resolves with the COG's own extent once deck.gl has read its header
  protected geotiffBoundsLoaded: Promise<LngLatBoundsLike | undefined> | undefined;
  private resolveGeotiffBounds: (bounds: LngLatBoundsLike | undefined) => void = () => {};

  // The COG, opened by us rather than by deck.gl, so that the requests reading it carry whatever the
  // resource's transform asks for. Held so that an opacity change rebuilds the layer around the same
  // open file instead of reading its header again.
  protected geotiff: GeoTIFF | undefined;

  // Whether any tile of this COG has been drawn, which is what tells a COG that can't be drawn at
  // all from one tile of it that couldn't. Reset per attach, alongside everything else a fresh load
  // attempt starts over. See reportTileError.
  protected anyTileDrawn = false;

  attach(map: maplibregl.Map, style: MapLibreStyle): this {
    super.attach(map, style);
    this.deckOverlay = this.getDeckOverlay();
    this.decoderPool ??= this.createDecoderPool();
    this.drawnState = { visible: true, opacity: style.opacity };
    this.geotiffBoundsLoaded = new Promise(resolve => (this.resolveGeotiffBounds = resolve));
    this.anyTileDrawn = false;
    return this;
  }

  // Nothing for MapLibre to fetch or draw: deck.gl reads the COG itself, through the source opened in
  // preview() rather than through MapLibre's transformRequest.
  protected async createSources(): Promise<[]> {
    return [];
  }

  // Registers the logical layer so the layers panel can offer it, but hands MapLibre no layer of its
  // own - deck.gl's overlay is already on the map, and the layer goes to that instead.
  protected async createLayers(): Promise<AddLayerObject[]> {
    this.previewLayers.push({
      id: this.getLayerId(),
      title: this.resource.label(),
      defaultOpacity: this.style.opacity,
      styleLayers: [{ id: this.getLayerId(), type: 'custom' }],
    });

    return [];
  }

  protected getLayerId(): string {
    return `${this.resource.id}-cog`;
  }

  // Opening the COG here rather than leaving deck.gl to do it is what lets a restricted one be drawn:
  // deck.gl only reads a URL with a plain fetch. It also means a COG that refuses to be read fails the
  // preview, so the alert names it, where before it only turned up in the console.
  async preview(): Promise<void> {
    await super.preview();
    this.geotiff = await this.loadGeoTIFF();
    this.drawDeckLayer();
  }

  protected async loadGeoTIFF(): Promise<GeoTIFF> {
    return await openGeoTIFF(this.resource.url, this.requestTransform);
  }

  async clearPreview() {
    await super.clearPreview();
    this.deckOverlay?.setProps({ layers: [] });
    this.geotiff = undefined;
  }

  // MapLibre knows nothing about this layer, so the inherited version - which starts by looking it
  // up in the style - would silently do nothing. deck.gl takes both as props instead.
  protected applyStyleLayerState(_styleLayer: PreviewStyleLayer, state: LayerState) {
    this.drawnState = state;
    this.drawDeckLayer();
  }

  // Hand deck.gl the layer as it should now be drawn. Rebuilt rather than mutated because that is
  // how deck.gl takes changes; it matches the layer by id and updates the props in place, so the
  // tiles already decoded are kept rather than fetched again.
  protected drawDeckLayer() {
    if (!this.deckOverlay || !this.drawnState || !this.geotiff) return;
    this.deckOverlay.setProps({ layers: [this.createDeckLayer(this.geotiff, this.drawnState)] });
  }

  protected createDeckLayer(geotiff: GeoTIFF, state: LayerState): COGLayer {
    return new COGLayer({
      id: this.getLayerId(),
      // The open COG, not a URL: handed one of those, deck.gl opens it with a plain fetch that no
      // transform can reach. (And never getMapLibreSourceUrl(), which prefixes the cog:// scheme the
      // maplibre-cog-protocol path needs and deck.gl's loader cannot read.)
      geotiff,
      visible: isLayerDrawn(state),
      opacity: state.opacity,
      onGeoTIFFLoad: (_data, options) => {
        const { west, south, east, north } = options.geographicBounds;
        this.resolveGeotiffBounds([
          [west, south],
          [east, north],
        ]);
      },
      onTileLoad: () => (this.anyTileDrawn = true),
      onTileError: (error: unknown) => this.reportTileError(error),
      parameters: { depthCompare: 'always', cullMode: 'back' },
      pool: this.decoderPool,
    });
  }

  // A COG can only fail once its tiles start arriving, which is after preview() has resolved - so a
  // file deck.gl refuses to draw used to leave the map empty with the reason only in the console.
  // deck.gl reports each such tile here; overriding it also takes over from its own handler, which
  // logs every one of them.
  //
  // Only the first failure of a COG that has drawn nothing is worth an alert. A COG can be sparse by
  // design, and a tile that failed among tiles that didn't means a hole in a preview the user can
  // see rather than a preview that isn't there - not worth replacing with an error. deck.gl drops a
  // cancelled tile before calling back, so a pan that abandons its reads never arrives here at all,
  // but a decoder that notices the abort itself can still throw one.
  protected reportTileError(error: unknown) {
    if ((error as { name?: unknown } | null)?.name === 'AbortError') return;

    if (this.anyTileDrawn) {
      console.warn(`Could not draw a tile of ${this.url}:`, error);
      return;
    }

    console.error(`Error drawing ${this.url}:`, error);
    this.onError?.(error);
  }

  // Disable the web worker decoder pool; it appears to error because it can't find /worker.js.
  // See: https://developmentseed.org/deck.gl-raster/api/geotiff/type-aliases/DecoderPoolOptions/
  // See also: https://github.com/developmentseed/deck.gl-raster/issues/364
  protected createDecoderPool(): DecoderPool {
    return new DecoderPool({ createWorker: undefined });
  }

  // The record's own bounding box when it has one, since that needs no waiting. Otherwise the COG's,
  // which means waiting on deck.gl to read its header.
  async getBounds(): Promise<LngLatBoundsLike | undefined> {
    const declared = await super.getBounds();
    if (declared) return declared;

    const timeout = new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), HEADER_TIMEOUT));
    return await Promise.race([this.geotiffBoundsLoaded ?? timeout, timeout]);
  }

  // The overlay every deck previewer on this map draws into. MapLibre offers no way to ask what
  // controls it already has, so this reads the private list rather than adding a second overlay.
  protected getDeckOverlay(): DeckOverlay {
    const existing = this.map._controls.find(control => control instanceof DeckOverlay);
    if (existing) return existing;

    const overlay = new DeckOverlay({ interleaved: true });
    this.map.addControl(overlay);
    return overlay;
  }
}
