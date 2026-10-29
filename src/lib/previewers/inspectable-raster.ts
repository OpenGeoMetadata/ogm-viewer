import type { CircleLayerSpecification, GeoJSONSource, LayerSpecification, LineLayerSpecification, MapGeoJSONFeature } from 'maplibre-gl';

import RasterPreviewer from './raster';
import type { PixelWindow } from '../geometry';

const NO_FEATURES: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

export default abstract class InspectableRasterPreviewer extends RasterPreviewer {
  private serviceAnswers = false;

  get canInspect(): boolean {
    return this.serviceAnswers;
  }

  async preview(): Promise<void> {
    if (!this.map.getSource(this.highlightSourceId)) {
      this.map.addSource(this.highlightSourceId, { type: 'geojson', data: NO_FEATURES });
    }
    await super.preview();

    this.serviceAnswers = await this.checkInspectable().catch(error => {
      console.warn(`Could not determine whether ${this.resource.url} can be inspected:`, error);
      return false;
    });
  }

  async clearPreview(): Promise<void> {
    await super.clearPreview();
    if (!this.attached) return;
    if (this.map.getSource(this.highlightSourceId)) {
      this.map.removeSource(this.highlightSourceId);
    }
  }

  highlightFeatures(features: MapGeoJSONFeature[]) {
    const data: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: features.filter(feature => feature.geometry).map(({ id, geometry }) => ({ type: 'Feature', id, geometry, properties: {} })),
    };
    this.highlightSource?.setData(data);
  }

  clearHighlight() {
    this.highlightSource?.setData(NO_FEATURES);
  }

  abstract inspect(window: PixelWindow): Promise<MapGeoJSONFeature[]>;

  protected async checkInspectable(): Promise<boolean> {
    return true;
  }

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

  protected createHighlightPointLayer(): CircleLayerSpecification {
    return {
      id: `${this.highlightSourceId}-points`,
      type: 'circle',
      source: this.highlightSourceId,
      layout: {
        visibility: 'visible',
      },
      paint: {
        'circle-color': this.style.selectedColor,
        'circle-opacity': this.style.highlightOpacity,
        'circle-stroke-color': this.style.strokeSelectedColor,
        'circle-stroke-width': 2,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 2, 12, 4],
      },
      filter: ['==', ['geometry-type'], 'Point'],
    };
  }

  private get highlightSource() {
    return this.map.getSource(this.highlightSourceId) as GeoJSONSource | undefined;
  }
}
