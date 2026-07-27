import { describe, it, expect, beforeEach } from '@stencil/vitest';

import EsriFeatureLayerPreviewer from './esri-feature-layer';
import EsriFeatureLayerResource from '../resources/esri-feature-layer';
import type { MapLibreStyle } from '../themes/maplibre';

// Just enough of a MapLibre map to record what the previewer adds and draws
class FakeMap {
  sources = new Map<string, { type: string; data?: GeoJSON.GeoJSON | string }>();
  layers = new Map<string, { 'id': string; 'type': string; 'source': string; 'source-layer'?: string }>();

  getSource(id: string) {
    return this.sources.get(id);
  }
  addSource(id: string, spec: { type: string; data?: GeoJSON.GeoJSON | string }) {
    this.sources.set(id, { ...spec });
  }
  removeSource(id: string) {
    this.sources.delete(id);
  }
  getLayer(id: string) {
    return this.layers.get(id);
  }
  addLayer(layer: { id: string; type: string; source: string }) {
    if (!this.sources.has(layer.source)) throw new Error(`No source ${layer.source} for layer ${layer.id}`);
    this.layers.set(layer.id, layer);
  }
  removeLayer(id: string) {
    this.layers.delete(id);
  }
}

const style = {
  opacity: 0.8,
  fillColor: '#00f',
  fillOpacity: 0.5,
  fillHighlightColor: '#0ff',
  fillHighlightOpacity: 0.8,
  fillSelectedColor: '#0f0',
  strokeColor: '#000',
  strokeHighlightColor: '#0ff',
  strokeSelectedColor: '#0a0',
  textColor: '#000',
  textFont: 'Noto Sans Regular',
  textSize: 12,
} as MapLibreStyle;

const LAYER = 'https://example.org/arcgis/rest/services/Landscape_Trees/FeatureServer/0';

const FEATURES: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [{ type: 'Feature', id: 1, geometry: { type: 'Point', coordinates: [-82.44, 35.61] }, properties: { Spp_Code: 'ULPU' } }],
};

// Hands over features it already has instead of querying the service for them
class TestResource extends EsriFeatureLayerResource {
  async getData() {
    return FEATURES;
  }
}

let map: FakeMap;
let previewer: EsriFeatureLayerPreviewer;

beforeEach(async () => {
  map = new FakeMap();
  previewer = new EsriFeatureLayerPreviewer(new TestResource('trees', LAYER), map as unknown as maplibregl.Map, style);
  await previewer.preview();
});

describe('EsriFeatureLayerPreviewer#preview', () => {
  it('hands MapLibre the features rather than a URL to fetch them from', () => {
    // The query has to be paged, and may need converting, so MapLibre can't fetch it itself
    expect(map.sources.get('trees-esri-feature-layer')?.data).toBe(FEATURES);
  });

  it('keeps its source apart from the one plain GeoJSON in the same record would use', () => {
    expect([...map.sources.keys()]).toEqual(['trees-esri-feature-layer']);
  });

  it('draws the features with the styled vector layers, one set per geometry type', () => {
    expect([...map.layers.keys()]).toEqual([
      'trees-esri-feature-layer-esri-polygons',
      'trees-esri-feature-layer-esri-polygon-outlines',
      'trees-esri-feature-layer-esri-lines',
      'trees-esri-feature-layer-esri-points',
      'trees-esri-feature-layer-esri-polygon-labels',
      'trees-esri-feature-layer-esri-line-labels',
      'trees-esri-feature-layer-esri-point-labels',
    ]);
  });

  it('draws every layer from the one GeoJSON source, with no source layer to name', () => {
    map.layers.forEach(layer => {
      expect(layer.source).toEqual('trees-esri-feature-layer');
      expect(layer['source-layer']).toBeUndefined();
    });
  });
});

describe('EsriFeatureLayerPreviewer#clearPreview', () => {
  it('removes the features and the layers drawing them', async () => {
    await previewer.clearPreview();

    expect(map.sources.size).toEqual(0);
    expect(map.layers.size).toEqual(0);
  });
});
