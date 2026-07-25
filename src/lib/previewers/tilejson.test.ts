import { describe, it, expect, vi, afterEach } from '@stencil/vitest';

import TileJSONRasterPreviewer from './tilejson-raster';
import TileJSONVectorPreviewer from './tilejson-vector';
import TileJSONSource from '../sources/tilejson';
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

const TILEJSON_URL = 'https://example.com/tilejson.json';
const BALKANS_BOUNDS: [number, number, number, number] = [19.333333, 39.75, 29.333333, 43.083333];

// A raster tileset, as a service like titiler describes one
const rasterDoc = {
  tilejson: '3.0.0',
  tiles: ['https://example.com/tiles/{z}/{x}/{y}@1x.png'],
  minzoom: 0,
  maxzoom: 16,
  bounds: BALKANS_BOUNDS,
};

// A vector tileset with more than one layer in its tiles
const vectorDoc = {
  tilejson: '3.0.0',
  tiles: ['https://example.com/tiles/{z}/{x}/{y}.pbf'],
  vector_layers: [{ id: 'districts' }, { id: 'places' }],
  bounds: BALKANS_BOUNDS,
};

// Serve a TileJSON document at the source URL. Every source fetches it lazily, so nothing has been
// requested until the previewer asks.
const serve = (doc: object) => {
  vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(doc)));
  return new TileJSONSource('princeton-fk4544658v', TILEJSON_URL);
};

afterEach(() => vi.restoreAllMocks());

describe('TileJSONRasterPreviewer#preview', () => {
  const preview = async (doc: object) => {
    const map = new FakeMap();
    const previewer = new TileJSONRasterPreviewer(serve(doc), map as unknown as maplibregl.Map, style);
    await previewer.preview();
    return { map, previewer };
  };

  it('hands MapLibre the document URL rather than the tile template', async () => {
    const { map } = await preview(rasterDoc);
    const source = map.sources.get('princeton-fk4544658v-tilejson');

    expect(source.type).toEqual('raster');
    expect(source.url).toEqual(TILEJSON_URL);
    expect(source.tiles).toBeUndefined();
  });

  it('draws the tiles at 256px, the size a template implies', async () => {
    const { map } = await preview(rasterDoc);
    expect(map.sources.get('princeton-fk4544658v-tilejson').tileSize).toEqual(256);
  });

  it('defers to a tile size the document declares', async () => {
    const { map } = await preview({ ...rasterDoc, tileSize: 512 });
    expect(map.sources.get('princeton-fk4544658v-tilejson').tileSize).toEqual(512);
  });

  it('adds a single raster layer over the source', async () => {
    const { map, previewer } = await preview(rasterDoc);

    expect([...map.layers.keys()]).toEqual(['princeton-fk4544658v-tilejson']);
    expect(map.layers.get('princeton-fk4544658v-tilejson').type).toEqual('raster');
    expect(previewer.layerIds).toEqual(['princeton-fk4544658v-tilejson']);
  });

  it('takes its bounds from the document', async () => {
    const { previewer } = await preview(rasterDoc);
    expect(await previewer.getBounds()).toEqual([
      [19.333333, 39.75],
      [29.333333, 43.083333],
    ]);
  });

  it('has no bounds when the document leaves them out', async () => {
    const { bounds: _bounds, ...doc } = rasterDoc;
    const { previewer } = await preview(doc);
    expect(await previewer.getBounds()).toBeUndefined();
  });

  it('removes what it added when cleared', async () => {
    const { map, previewer } = await preview(rasterDoc);
    await previewer.clearPreview();

    expect(map.sources.size).toEqual(0);
    expect(map.layers.size).toEqual(0);
  });
});

describe('TileJSONVectorPreviewer#preview', () => {
  const preview = async (doc: object) => {
    const map = new FakeMap();
    const previewer = new TileJSONVectorPreviewer(serve(doc), map as unknown as maplibregl.Map, style);
    await previewer.preview();
    return { map, previewer };
  };

  it('hands MapLibre the document URL and the tile encoding', async () => {
    const { map } = await preview(vectorDoc);
    const source = map.sources.get('princeton-fk4544658v-tilejson');

    expect(source.type).toEqual('vector');
    expect(source.url).toEqual(TILEJSON_URL);
    expect(source.encoding).toEqual('mvt');
  });

  it('asks for MapLibre Tile decoding when the tiles are .mlt', async () => {
    const { map } = await preview({ ...vectorDoc, tiles: ['https://example.com/tiles/{z}/{x}/{y}.mlt'] });
    expect(map.sources.get('princeton-fk4544658v-tilejson').encoding).toEqual('mlt');
  });

  it('styles every layer the document lists', async () => {
    const { map } = await preview(vectorDoc);
    const suffixes = ['polygons', 'polygon-outlines', 'lines', 'points', 'polygon-labels', 'line-labels', 'point-labels'];

    expect([...map.layers.keys()]).toEqual(['districts', 'places'].flatMap(layer => suffixes.map(suffix => `princeton-fk4544658v-tilejson-${layer}-${suffix}`)));
  });

  it('names the layer within the tiles that each style layer reads', async () => {
    const { map } = await preview(vectorDoc);

    // Without this a layer would draw from whichever layer of the tiles came first
    expect(map.layers.get('princeton-fk4544658v-tilejson-places-points')['source-layer']).toEqual('places');
    expect([...map.layers.values()].every(layer => layer['source-layer'])).toBe(true);
  });

  it('takes its bounds from the document', async () => {
    const { previewer } = await preview(vectorDoc);
    expect(await previewer.getBounds()).toEqual([
      [19.333333, 39.75],
      [29.333333, 43.083333],
    ]);
  });
});
