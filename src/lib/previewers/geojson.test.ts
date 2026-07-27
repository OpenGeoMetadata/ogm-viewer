import { describe, it, expect } from '@stencil/vitest';

import GeoJsonPreviewer from './geojson';
import OpenIndexMapPreviewer from './openindexmap';
import GeoJsonResource from '../resources/geojson';
import OpenIndexMapResource from '../resources/openindexmap';
import type { MapLibreStyle } from '../themes/maplibre';

// Just enough of a MapLibre map to record what the previewer adds
class FakeMap {
  sources = new Map<string, any>();
  layers = new Map<string, any>();

  getSource(id: string) {
    return this.sources.get(id);
  }
  addSource(id: string, spec: any) {
    this.sources.set(id, spec);
  }
  removeSource(id: string) {
    this.sources.delete(id);
  }
  getLayer(id: string) {
    return this.layers.get(id);
  }
  addLayer(layer: any) {
    // MapLibre refuses a layer whose source hasn't been added yet
    if (!this.sources.has(layer.source)) throw new Error(`No source ${layer.source} for layer ${layer.id}`);
    this.layers.set(layer.id, layer);
  }
  removeLayer(id: string) {
    this.layers.delete(id);
  }
}

// The previewers only read the colors and label styles, none of which these tests assert on
const style = { opacity: 0.8, fillColor: '#00f', strokeColor: '#009', textColor: '#000', textFont: 'Noto Sans Regular', textSize: 12 } as MapLibreStyle;

const GEOJSON_URL = 'https://example.com/index-map.json';

// Nothing here fetches: the source URL and the layer names are known without reading the document
const previewGeoJson = async () => {
  const map = new FakeMap();
  const previewer = new GeoJsonPreviewer(new GeoJsonResource('princeton-fk4544658v', GEOJSON_URL), map as unknown as maplibregl.Map, style);
  await previewer.preview();
  return { map, previewer };
};

const previewIndexMap = async () => {
  const map = new FakeMap();
  const previewer = new OpenIndexMapPreviewer(new OpenIndexMapResource('princeton-fk4544658v', GEOJSON_URL), map as unknown as maplibregl.Map, style);
  await previewer.preview();
  return { map, previewer };
};

const SUFFIXES = ['polygons', 'polygon-outlines', 'lines', 'points', 'polygon-labels', 'line-labels', 'point-labels'];

describe('GeoJsonPreviewer#preview', () => {
  it('hands MapLibre the document URL as a geojson source', async () => {
    const { map, previewer } = await previewGeoJson();
    const source = map.sources.get('princeton-fk4544658v-geojson');

    expect(source.type).toEqual('geojson');
    expect(source.data).toEqual(GEOJSON_URL);
    expect(previewer.sourceIds).toEqual(['princeton-fk4544658v-geojson']);
  });

  it('draws its style layers from the source it added', async () => {
    const { map } = await previewGeoJson();

    // A layer pointing at any other ID would be dropped by MapLibre, drawing nothing
    expect([...map.layers.values()].every(layer => map.sources.has(layer.source))).toBe(true);
    expect([...map.layers.keys()]).toEqual(SUFFIXES.map(suffix => `princeton-fk4544658v-geojson-geojson-${suffix}`));
  });

  it('removes what it added when cleared', async () => {
    const { map, previewer } = await previewGeoJson();
    await previewer.clearPreview();

    expect(map.sources.size).toEqual(0);
    expect(map.layers.size).toEqual(0);
  });
});

describe('OpenIndexMapPreviewer#preview', () => {
  it('draws the index map polygons from the source it added', async () => {
    const { map } = await previewIndexMap();
    const polygons = map.layers.get('princeton-fk4544658v-geojson-indexmap-polygons');

    expect(polygons.type).toEqual('fill');
    expect(map.sources.has(polygons.source)).toBe(true);
  });

  it('styles the one layer an index map has', async () => {
    const { map } = await previewIndexMap();

    expect([...map.layers.keys()]).toEqual(SUFFIXES.map(suffix => `princeton-fk4544658v-geojson-indexmap-${suffix}`));
  });
});
