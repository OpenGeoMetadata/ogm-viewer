import { describe, it, expect, vi, afterEach } from '@stencil/vitest';

import TileJsonRasterPreviewer from './tilejson-raster';
import TileJsonVectorPreviewer from './tilejson-vector';
import TileJsonResource from '../resources/tilejson';
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
  setPaintProperty(id: string, name: string, value: unknown) {
    // MapLibre refuses to style a layer the current style doesn't hold
    const layer = this.layers.get(id);
    if (!layer) throw new Error(`No layer ${id} to paint`);
    layer.paint = { ...layer.paint, [name]: value };
  }
  setLayoutProperty(id: string, name: string, value: unknown) {
    const layer = this.layers.get(id);
    if (!layer) throw new Error(`No layer ${id} to lay out`);
    layer.layout = { ...layer.layout, [name]: value };
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
  return new TileJsonResource('princeton-fk4544658v', TILEJSON_URL);
};

afterEach(() => vi.restoreAllMocks());

describe('TileJsonRasterPreviewer#preview', () => {
  const preview = async (doc: object) => {
    const map = new FakeMap();
    const previewer = new TileJsonRasterPreviewer(serve(doc)).attach(map as unknown as maplibregl.Map, style);
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

// The genuinely multi-row case: a tileset holding more than one named layer. Every other previewer
// yields exactly one row in production, so this is where independent per-layer control is exercised.
describe('TileJsonVectorPreviewer#previewLayers', () => {
  const SUFFIXES = ['polygons', 'polygon-outlines', 'lines', 'points', 'polygon-labels', 'line-labels', 'point-labels'];
  const styleLayerIds = (layerId: string) => SUFFIXES.map(suffix => `princeton-fk4544658v-tilejson-${layerId}-${suffix}`);

  const preview = async (doc: object) => {
    const map = new FakeMap();
    const previewer = new TileJsonVectorPreviewer(serve(doc)).attach(map as unknown as maplibregl.Map, style);
    await previewer.preview();
    return { map, previewer };
  };

  it('gives each layer of the tileset its own row, named as the tileset named it', async () => {
    const { previewer } = await preview(vectorDoc);

    expect(previewer.previewLayers.map(layer => layer.id)).toEqual(['princeton-fk4544658v-tilejson-districts', 'princeton-fk4544658v-tilejson-places']);
    expect(previewer.previewLayers.map(layer => layer.title)).toEqual(['Districts', 'Places']);
  });

  it('drives all seven style layers from each row', async () => {
    const { previewer } = await preview(vectorDoc);

    expect(previewer.previewLayers.map(layer => layer.styleLayers.map(styleLayer => styleLayer.id))).toEqual([styleLayerIds('districts'), styleLayerIds('places')]);
  });

  it('reads every style layer from the named layer of the tileset', async () => {
    const { map } = await preview(vectorDoc);

    styleLayerIds('places').forEach(id => expect(map.layers.get(id)['source-layer']).toEqual('places'));
  });

  it('leaves one row untouched when the other is hidden', async () => {
    const { map, previewer } = await preview(vectorDoc);

    previewer.applyLayerState(new Map([['princeton-fk4544658v-tilejson-places', { visible: false, opacity: 1 }]]));

    styleLayerIds('places').forEach(id => expect(map.layers.get(id).layout.visibility).toEqual('none'));
    styleLayerIds('districts').forEach(id => expect(map.layers.get(id).layout.visibility).toEqual('visible'));
    expect(previewer.visibleLayerIds).toEqual(styleLayerIds('districts'));
    // One row still drawn is still a drawn preview
    expect(previewer.anyLayerVisible).toBe(true);
  });

  it('fades one row without touching the other', async () => {
    const { map, previewer } = await preview(vectorDoc);

    previewer.applyLayerState(new Map([['princeton-fk4544658v-tilejson-places', { visible: true, opacity: 0.5 }]]));

    expect(map.layers.get('princeton-fk4544658v-tilejson-places-lines').paint['line-opacity']).toEqual(0.5);
    // The row the user never touched keeps the opacity the theme drew it at
    expect(map.layers.get('princeton-fk4544658v-tilejson-districts-lines').paint['line-opacity']).toEqual(style.opacity);
  });

  it('still offers a raster tileset exactly one row', async () => {
    const map = new FakeMap();
    const previewer = new TileJsonRasterPreviewer(serve(rasterDoc)).attach(map as unknown as maplibregl.Map, style);
    await previewer.preview();

    expect(previewer.previewLayers.map(layer => layer.title)).toEqual(['TileJSON']);
  });
});

describe('TileJsonVectorPreviewer#preview', () => {
  const preview = async (doc: object) => {
    const map = new FakeMap();
    const previewer = new TileJsonVectorPreviewer(serve(doc)).attach(map as unknown as maplibregl.Map, style);
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
