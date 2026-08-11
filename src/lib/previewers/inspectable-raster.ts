import type { CircleLayerSpecification, GeoJSONSource, LayerSpecification, LineLayerSpecification, MapGeoJSONFeature } from 'maplibre-gl';

import RasterPreviewer from './raster';
import type { PixelWindow } from '../geometry';

// Contents of the highlight source when nothing is selected
const NO_FEATURES: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

// Tiles a server draws for us, plus a way to ask what lies under a click. Unlike a vector preview
// there are no client-side features to restyle when one is selected, but these services do hand
// back the geometry they matched, so we keep a GeoJSON source alongside the tiles and draw the
// selection into it.
export default abstract class InspectableRasterPreviewer extends RasterPreviewer {
  // Whether the server will actually answer a question about a click. Some won't - a tile cache
  // holds only pictures - and we don't know which until we've asked, so this settles during preview.
  //
  // A narrower question than Previewer.inspectable, which asks whether this kind of preview has
  // anything to be asked about in the first place. These tiles always do; the service may not.
  private serviceAnswers = false;

  get canInspect(): boolean {
    return this.serviceAnswers;
  }

  // Add the highlight source ahead of the layers that draw from it
  async preview(): Promise<void> {
    if (!this.map.getSource(this.highlightSourceId)) {
      this.map.addSource(this.highlightSourceId, { type: 'geojson', data: NO_FEATURES });
    }
    await super.preview();

    // A service that won't say whether it can be inspected is treated as though it can't, rather
    // than failing a preview whose tiles drew perfectly well
    this.serviceAnswers = await this.checkInspectable().catch(error => {
      console.warn(`Could not determine whether ${this.resource.url} can be inspected:`, error);
      return false;
    });
  }

  // The highlight layers go with the rest of the preview, since they're tracked in layerIds,
  // but the extra source is ours to clean up
  async clearPreview(): Promise<void> {
    await super.clearPreview();
    if (!this.attached) return;
    if (this.map.getSource(this.highlightSourceId)) {
      this.map.removeSource(this.highlightSourceId);
    }
  }

  // Outline the given features on top of the tiles, replacing any previous highlight
  highlightFeatures(features: MapGeoJSONFeature[]) {
    const data: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      // A server can answer with attributes and no geometry, which we have nothing to draw for
      features: features.filter(feature => feature.geometry).map(({ id, geometry }) => ({ type: 'Feature', id, geometry, properties: {} })),
    };
    this.highlightSource?.setData(data);
  }

  // Drop the highlight, leaving the tiles alone
  clearHighlight() {
    this.highlightSource?.setData(NO_FEATURES);
  }

  // The features under the given window, as GeoJSON in degrees and ready for the popup
  abstract inspect(window: PixelWindow): Promise<MapGeoJSONFeature[]>;

  // Whether the service behind this preview answers inspection requests. Subclasses that can
  // always be asked leave this alone.
  protected async checkInspectable(): Promise<boolean> {
    return true;
  }

  // Tiles first, so the highlight draws over them. The highlight belongs to the tiles' own row
  // rather than one of its own: it's machinery for reading the tiles, so it hides when they do,
  // but it's flagged internal so fading them never fades the answer drawn on top.
  protected async createLayers(): Promise<LayerSpecification[]> {
    const layers = [...(await super.createLayers()), this.createHighlightOutlineLayer(), this.createHighlightPointLayer()];

    this.findPreviewLayer(this.getSourceId())?.styleLayers.push(
      { id: `${this.highlightSourceId}-outlines`, type: 'line', internal: true },
      { id: `${this.highlightSourceId}-points`, type: 'circle', internal: true },
    );

    return layers;
  }

  protected get highlightSourceId(): string {
    return `${this.getSourceId()}-highlight`;
  }

  // Outline for selected polygons and lines
  protected createHighlightOutlineLayer(): LineLayerSpecification {
    return {
      id: `${this.highlightSourceId}-outlines`,
      type: 'line',
      source: this.highlightSourceId,
      layout: {
        visibility: 'visible',
      },
      paint: {
        'line-color': this.style.strokeSelectedColor,
        'line-width': 2,
      },
      filter: ['!=', ['geometry-type'], 'Point'],
    };
  }

  // Outline for selected points
  protected createHighlightPointLayer(): CircleLayerSpecification {
    return {
      id: `${this.highlightSourceId}-points`,
      type: 'circle',
      source: this.highlightSourceId,
      layout: {
        visibility: 'visible',
      },
      paint: {
        'circle-color': this.style.fillSelectedColor,
        'circle-opacity': this.style.fillHighlightOpacity,
        'circle-stroke-color': this.style.strokeSelectedColor,
        'circle-stroke-width': 2,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 2, 12, 4],
      },
      filter: ['==', ['geometry-type'], 'Point'],
    };
  }

  // The MapLibre source holding the highlighted geometry
  private get highlightSource() {
    return this.map.getSource(this.highlightSourceId) as GeoJSONSource | undefined;
  }
}
