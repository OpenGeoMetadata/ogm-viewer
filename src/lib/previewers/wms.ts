import type { CircleLayerSpecification, GeoJSONSource, LayerSpecification, LineLayerSpecification, MapGeoJSONFeature } from 'maplibre-gl';

import type WmsResource from '../resources/wms';
import type { GetFeatureInfoOptions } from '../resources/wms';
import type { AddRasterSourceObject } from './raster';
import RasterPreviewer from './raster';

// Contents of the highlight source when nothing is selected
const NO_FEATURES: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
export default class WmsPreviewer extends RasterPreviewer {
  declare protected resource: WmsResource;

  // WMS sources have no scheme
  protected async createSources(): Promise<AddRasterSourceObject[]> {
    return [
      {
        id: `${this.resource.id}-wms`,
        type: 'raster',
        tiles: [await this.resource.getMapLibreSourceUrl()],
        tileSize: this.resource.getTileSize(),
      },
    ];
  }

  getSourceId(): string {
    return `${this.resource.id}-wms`;
  }

  // The server draws the tiles, so unlike a vector preview there are no client-side features to
  // restyle when one is selected. GetFeatureInfo does hand back the geometry it matched, so we
  // keep a GeoJSON source alongside the tiles and draw the selection into it.
  protected get highlightSourceId(): string {
    return `${this.getSourceId()}-highlight`;
  }

  // Add the highlight source ahead of the layers that draw from it
  async preview(): Promise<void> {
    if (!this.map.getSource(this.highlightSourceId)) {
      this.map.addSource(this.highlightSourceId, { type: 'geojson', data: NO_FEATURES });
    }
    await super.preview();
  }

  // The highlight layers go with the rest of the preview, since they're tracked in layerIds,
  // but the extra source is ours to clean up
  async clearPreview(): Promise<void> {
    await super.clearPreview();
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

  // Delegate inspection to the source, which makes the GetFeatureInfo request
  async inspect(options: GetFeatureInfoOptions) {
    return await this.resource.inspect(options);
  }

  // Tiles first, so the highlight draws over them
  protected async createLayers(): Promise<LayerSpecification[]> {
    return [...(await super.createLayers()), this.createHighlightOutlineLayer(), this.createHighlightPointLayer()];
  }

  // Outline for selected polygons and lines
  protected createHighlightOutlineLayer(): LineLayerSpecification {
    return {
      id: `${this.highlightSourceId}-outlines`,
      type: 'line',
      source: this.highlightSourceId,
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
