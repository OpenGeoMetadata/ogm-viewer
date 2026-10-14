import { describe, it, expect, vi, afterEach } from '@stencil/vitest';
import { Color, createPropertyExpression, featureFilter, latest } from '@maplibre/maplibre-gl-style-spec';
import type { MapGeoJSONFeature, MapLibreMap } from 'maplibre-gl';

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
  setFilter(id: string, filter: unknown) {
    const layer = this.layers.get(id);
    if (!layer) throw new Error(`No layer ${id} to filter`);
    layer.filter = filter;
  }
}

// The previewers only read the colors and label styles, none of which these tests assert on but the
// selected ones
const style = {
  opacity: 0.8,
  dataColor: '#00f',
  strokeColor: '#009',
  selectedColor: '#ff0',
  strokeSelectedColor: '#990',
  highlightColor: '#f60',
  strokeHighlightColor: '#930',
  invalidColor: '#999',
  strokeInvalidColor: '#666',
  textColor: '#000',
  textFont: 'Noto Sans Regular',
  textSize: 12,
} as MapLibreStyle;

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
    const previewer = new TileJsonRasterPreviewer(serve(doc)).attach(map as unknown as MapLibreMap, style);
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
  // Each geometry layer drawn again for the selected feature, by feature-state and by matching for a
  // feature with no id: hidden with its row, never queried
  const SELECTED_SUFFIXES = ['polygons-selected', 'polygon-outlines-selected', 'lines-selected', 'points-selected'];
  const MATCHED_SUFFIXES = ['polygons-matched', 'polygon-outlines-matched', 'lines-matched', 'points-matched'];
  const ids = (layerId: string, suffixes: string[]) => suffixes.map(suffix => `princeton-fk4544658v-tilejson-${layerId}-${suffix}`);
  const styleLayerIds = (layerId: string) => ids(layerId, [...SUFFIXES, ...SELECTED_SUFFIXES, ...MATCHED_SUFFIXES]);

  const preview = async (doc: object) => {
    const map = new FakeMap();
    const previewer = new TileJsonVectorPreviewer(serve(doc)).attach(map as unknown as MapLibreMap, style);
    await previewer.preview();
    return { map, previewer };
  };

  it('gives each layer of the tileset its own row, named as the tileset named it', async () => {
    const { previewer } = await preview(vectorDoc);

    expect(previewer.previewLayers.map(layer => layer.id)).toEqual(['princeton-fk4544658v-tilejson-districts', 'princeton-fk4544658v-tilejson-places']);
    expect(previewer.previewLayers.map(layer => layer.title)).toEqual(['Districts', 'Places']);
  });

  it('drives all fifteen style layers from each row', async () => {
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
    expect(previewer.visibleLayerIds).toEqual(ids('districts', SUFFIXES));
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
    const previewer = new TileJsonRasterPreviewer(serve(rasterDoc)).attach(map as unknown as MapLibreMap, style);
    await previewer.preview();

    expect(previewer.previewLayers.map(layer => layer.title)).toEqual(['TileJSON']);
  });
});

describe('TileJsonVectorPreviewer#preview', () => {
  const preview = async (doc: object) => {
    const map = new FakeMap();
    const previewer = new TileJsonVectorPreviewer(serve(doc)).attach(map as unknown as MapLibreMap, style);
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
    const suffixes = [
      'polygons',
      'polygons-selected',
      'polygons-matched',
      'polygon-outlines',
      'polygon-outlines-selected',
      'polygon-outlines-matched',
      'lines',
      'lines-selected',
      'lines-matched',
      'points',
      'points-selected',
      'points-matched',
      'polygon-labels',
      'line-labels',
      'point-labels',
    ];

    expect([...map.layers.keys()]).toEqual(['districts', 'places'].flatMap(layer => suffixes.map(suffix => `princeton-fk4544658v-tilejson-${layer}-${suffix}`)));
  });

  it('names the layer within the tiles that each style layer reads', async () => {
    const { map } = await preview(vectorDoc);

    // Without this a layer would draw from whichever layer of the tiles came first
    expect(map.layers.get('princeton-fk4544658v-tilejson-places-points')['source-layer']).toEqual('places');
    expect([...map.layers.values()].every(layer => layer['source-layer'])).toBe(true);
  });

  // A tile's ids say nothing about which of its features is drawn last, so there is no key that would
  // give a stack's label to the one on top; see GeoJsonPreviewer for a source whose ids do
  it('leaves its labels to be placed in the order its tiles hold them', async () => {
    const { map } = await preview(vectorDoc);
    const labels = [...map.layers.values()].filter(layer => layer.type === 'symbol');

    expect(labels).toHaveLength(6);
    labels.forEach(layer => expect(layer.layout['symbol-sort-key']).toBeUndefined());
  });

  it('takes its bounds from the document', async () => {
    const { previewer } = await preview(vectorDoc);
    expect(await previewer.getBounds()).toEqual([
      [19.333333, 39.75],
      [29.333333, 43.083333],
    ]);
  });
});

// A tileset cut by tippecanoe without --generate-ids, the way HOT cuts its OpenStreetMap exports: no
// feature ids, so nothing for feature-state to hang a selection on, and the OSM id only a property
describe('TileJsonVectorPreviewer#matchSelection', () => {
  const SOURCE = 'princeton-fk4544658v-tilejson';
  const layerId = (layer: string, suffix: string) => `${SOURCE}-${layer}-${suffix}`;
  const MATCHED = ['polygons-matched', 'polygon-outlines-matched', 'lines-matched', 'points-matched'];

  // MVT geometry types, which is what a filter's ['geometry-type'] reads
  const POINT = 1;
  const POLYGON = 3;

  const temple = {
    type: 'Feature',
    source: SOURCE,
    sourceLayer: 'places',
    id: undefined,
    geometry: { type: 'Polygon', coordinates: [] },
    properties: { id: 'way/23630366', name: 'Wat Pho', tourism: 'attraction' },
  } as unknown as MapGeoJSONFeature;

  const preview = async () => {
    const map = new FakeMap();
    const previewer = new TileJsonVectorPreviewer(serve(vectorDoc)).attach(map as unknown as MapLibreMap, style);
    await previewer.preview();
    return { map, previewer };
  };

  // Whether MapLibre would draw a tile feature saying these things in this style layer
  const draws = (map: FakeMap, id: string, properties: object, type = POLYGON): boolean =>
    featureFilter(map.layers.get(id).filter, `layers.${id}.filter`).filter({ zoom: 12 }, { type, properties } as never) as boolean;

  // What a paint property comes to for a feature with no state at all, which is every feature without an id
  const paint = (map: FakeMap, id: string, name: string): unknown => {
    const layer = map.layers.get(id);
    const spec = (latest as unknown as Record<string, Record<string, object>>)[`paint_${layer.type}`][name];
    const expression = createPropertyExpression(layer.paint[name], `layers.${id}.paint.${name}`, spec as never);
    if (expression.result === 'error') throw new Error(JSON.stringify(expression.value));
    const value = (expression.value as { evaluate: (...args: unknown[]) => unknown }).evaluate({ zoom: 12 }, { type: POLYGON, properties: {} }, {});
    return value instanceof Color ? value.toString() : value;
  };
  const color = (hex: string) => Color.parse(hex)?.toString();

  it('draws nothing in its matched copies until something is selected', async () => {
    const { map } = await preview();

    ['places', 'districts'].forEach(layer => MATCHED.forEach(suffix => expect(draws(map, layerId(layer, suffix), temple.properties)).toBe(false)));
  });

  it('draws a selected feature with no id in its own layer’s copies, by what it says', async () => {
    const { map, previewer } = await preview();

    previewer.matchSelection(temple);

    expect(draws(map, layerId('places', 'polygons-matched'), temple.properties)).toBe(true);
    expect(draws(map, layerId('places', 'polygon-outlines-matched'), temple.properties)).toBe(true);
    expect(draws(map, layerId('places', 'polygons-matched'), { ...temple.properties, id: 'way/210284649' })).toBe(false);
  });

  // Every tile holding a piece of the feature holds the same properties, in whatever order
  it('matches every piece of it, however a tile lists its properties', async () => {
    const { map, previewer } = await preview();

    previewer.matchSelection(temple);

    expect(draws(map, layerId('places', 'polygons-matched'), { tourism: 'attraction', name: 'Wat Pho', id: 'way/23630366' })).toBe(true);
  });

  it('keeps each copy to its own kind of shape', async () => {
    const { map, previewer } = await preview();

    previewer.matchSelection(temple);

    expect(draws(map, layerId('places', 'points-matched'), temple.properties, POLYGON)).toBe(false);
    expect(draws(map, layerId('places', 'polygons-matched'), temple.properties, POINT)).toBe(false);
  });

  it('leaves the tileset’s other layers drawing nothing', async () => {
    const { map, previewer } = await preview();

    previewer.matchSelection(temple);

    MATCHED.forEach(suffix => expect(draws(map, layerId('districts', suffix), temple.properties)).toBe(false));
  });

  it('stops drawing it once the selection is cleared', async () => {
    const { map, previewer } = await preview();

    previewer.matchSelection(temple);
    previewer.matchSelection();

    expect(draws(map, layerId('places', 'polygons-matched'), temple.properties)).toBe(false);
  });

  // A filter of no conditions would match the whole layer
  it('draws nothing for a feature with nothing to match it by', async () => {
    const { map, previewer } = await preview();

    previewer.matchSelection({ ...temple, properties: {} } as unknown as MapGeoJSONFeature);

    expect(draws(map, layerId('places', 'polygons-matched'), {})).toBe(false);
    expect(draws(map, layerId('places', 'polygons-matched'), temple.properties)).toBe(false);
  });

  it('draws the match the way feature-state draws the selected feature', async () => {
    const { map } = await preview();

    expect(paint(map, layerId('places', 'polygons-matched'), 'fill-color')).toEqual(color(style.selectedColor));
    expect(paint(map, layerId('places', 'polygons-matched'), 'fill-opacity')).toEqual(1);
    expect(paint(map, layerId('places', 'polygon-outlines-matched'), 'line-color')).toEqual(color(style.strokeSelectedColor));
    expect(paint(map, layerId('places', 'polygon-outlines-matched'), 'line-width')).toEqual(2);
    expect(paint(map, layerId('places', 'lines-matched'), 'line-color')).toEqual(color(style.selectedColor));
    expect(paint(map, layerId('places', 'lines-matched'), 'line-opacity')).toEqual(1);
    expect(paint(map, layerId('places', 'points-matched'), 'circle-color')).toEqual(color(style.selectedColor));
    expect(paint(map, layerId('places', 'points-matched'), 'circle-stroke-color')).toEqual(color(style.strokeSelectedColor));
    expect(paint(map, layerId('places', 'points-matched'), 'circle-stroke-width')).toEqual(2);
    expect(paint(map, layerId('places', 'points-matched'), 'circle-opacity')).toEqual(1);
  });

  it('keeps the match solid when its row is faded', async () => {
    const { map, previewer } = await preview();

    previewer.applyLayerState(new Map([[`${SOURCE}-places`, { visible: true, opacity: 0.3 }]]));

    expect(paint(map, layerId('places', 'polygons-matched'), 'fill-opacity')).toEqual(1);
  });
});
