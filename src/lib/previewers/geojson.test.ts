import { describe, it, expect, beforeEach, afterEach, vi } from '@stencil/vitest';
import type { MapGeoJSONFeature, MapLibreMap } from 'maplibre-gl';

import GeoJsonPreviewer from './geojson';
import OpenIndexMapPreviewer from './openindexmap';
import { IS_LABEL_POINT, LABEL_POINT, labelMinZoom } from '../labels';
import GeoJsonResource from '../resources/geojson';
import OpenIndexMapResource from '../resources/openindexmap';
import type { MapLibreStyle } from '../themes/maplibre';

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
    if (!this.sources.has(layer.source)) throw new Error(`No source ${layer.source} for layer ${layer.id}`);
    this.layers.set(layer.id, layer);
  }
  removeLayer(id: string) {
    this.layers.delete(id);
  }
  setPaintProperty(id: string, name: string, value: unknown) {
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

const style = {
  opacity: 0.8,
  dataColor: '#00f',
  highlightColor: '#0ff',
  selectedColor: '#0f0',
  invalidColor: '#ff0',
  strokeColor: '#009',
  strokeHighlightColor: '#099',
  strokeSelectedColor: '#090',
  strokeInvalidColor: '#990',
  textColor: '#000',
  textFont: 'Noto Sans Regular',
  textSize: 12,
  highlightOpacity: 0.8,
  boundsOpacity: 0.5,
} as MapLibreStyle;

const GEOJSON_URL = 'https://example.com/index-map.json';

const square = (x: number, y: number, size: number) => [
  [
    [x, y],
    [x + size, y],
    [x + size, y + size],
    [x, y + size],
    [x, y],
  ],
];
const DOCUMENT: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: [square(0, 0, 10), square(11, 11, 1)] }, properties: { label: 'SF 20' } },
    { type: 'Feature', geometry: { type: 'Polygon', coordinates: square(20, 0, 4) }, properties: { label: 'SF 21' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [30, 2] }, properties: { label: 'Benchmark' } },
  ],
};

let fetches: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetches = vi.fn(async () => Response.json(DOCUMENT));
  vi.stubGlobal('fetch', fetches);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const previewGeoJson = async () => {
  const map = new FakeMap();
  const previewer = new GeoJsonPreviewer(new GeoJsonResource('princeton-fk4544658v', GEOJSON_URL)).attach(map as unknown as MapLibreMap, style);
  await previewer.preview();
  return { map, previewer };
};

const previewIndexMap = async () => {
  const map = new FakeMap();
  const previewer = new OpenIndexMapPreviewer(new OpenIndexMapResource('princeton-fk4544658v', GEOJSON_URL)).attach(map as unknown as MapLibreMap, style);
  await previewer.preview();
  return { map, previewer };
};

const SUFFIXES = ['polygons', 'polygon-outlines', 'lines', 'points', 'polygon-labels', 'line-labels', 'point-labels'];

const SELECTED_SUFFIXES = ['polygons-selected', 'polygon-outlines-selected', 'lines-selected', 'points-selected'];

const DRAWN = [
  'polygons',
  'polygons-selected',
  'polygon-outlines',
  'polygon-outlines-selected',
  'lines',
  'lines-selected',
  'points',
  'points-selected',
  'polygon-labels',
  'line-labels',
  'point-labels',
];

describe('GeoJsonPreviewer#preview', () => {
  it('hands MapLibre the document, numbered, with a label point after it for each polygon', async () => {
    const { map, previewer } = await previewGeoJson();
    const source = map.sources.get('princeton-fk4544658v-geojson');

    expect(fetches).toHaveBeenCalledWith(GEOJSON_URL, undefined);
    expect(source.type).toEqual('geojson');
    expect(source.data.features.map((feature: GeoJSON.Feature) => [feature.id, feature.geometry.type, feature.properties?.label])).toEqual([
      [0, 'MultiPolygon', 'SF 20'],
      [1, 'Polygon', 'SF 21'],
      [2, 'Point', 'Benchmark'],
      [0, 'Point', 'SF 20'],
      [1, 'Point', 'SF 21'],
    ]);
    expect(source.generateId).toBeUndefined();
    expect(previewer.sourceIds).toEqual(['princeton-fk4544658v-geojson']);
  });

  it('draws its style layers from the source it added', async () => {
    const { map } = await previewGeoJson();

    expect([...map.layers.values()].every(layer => map.sources.has(layer.source))).toBe(true);
    expect([...map.layers.keys()]).toEqual(DRAWN.map(suffix => `princeton-fk4544658v-geojson-geojson-${suffix}`));
  });

  it('removes what it added when cleared', async () => {
    const { map, previewer } = await previewGeoJson();
    await previewer.clearPreview();

    expect(map.sources.size).toEqual(0);
    expect(map.layers.size).toEqual(0);
  });

  it('draws again into an emptied style without doubling what it says it added', async () => {
    const { map, previewer } = await previewGeoJson();

    map.sources.clear();
    map.layers.clear();
    await previewer.preview();

    expect(previewer.sourceIds).toEqual(['princeton-fk4544658v-geojson']);
    expect(previewer.layerIds).toEqual(DRAWN.map(suffix => `princeton-fk4544658v-geojson-geojson-${suffix}`));
    expect(previewer.previewLayers).toHaveLength(1);
    expect(previewer.previewLayers[0].styleLayers).toHaveLength(SUFFIXES.length + SELECTED_SUFFIXES.length);
    expect(map.layers.size).toEqual(DRAWN.length);
    expect(fetches).toHaveBeenCalledTimes(1);
  });
});

const ROW_ID = 'princeton-fk4544658v-geojson-geojson';
const layerId = (suffix: string) => `princeton-fk4544658v-geojson-geojson-${suffix}`;
const SELECTED = ['boolean', ['feature-state', 'selected'], false];
const HOVER = ['boolean', ['feature-state', 'hover'], false];
const UNAVAILABLE = ['==', ['get', 'available'], false];

describe('GeoJsonPreviewer#previewLayers', () => {
  it('offers the user one layer, not the eleven it takes to draw it', async () => {
    const { previewer } = await previewGeoJson();

    expect(previewer.previewLayers).toHaveLength(1);
    expect(previewer.previewLayers[0].id).toEqual(ROW_ID);
    expect(previewer.previewLayers[0].title).toEqual('GeoJSON');
    expect(previewer.previewLayers[0].defaultOpacity).toEqual(style.opacity);
    expect(previewer.previewLayers[0].styleLayers.map(styleLayer => styleLayer.id)).toEqual([...SUFFIXES, ...SELECTED_SUFFIXES].map(layerId));
  });

  it('records the type of each style layer, since that decides which paint property carries opacity', async () => {
    const { previewer } = await previewGeoJson();

    expect(previewer.previewLayers[0].styleLayers.map(styleLayer => styleLayer.type)).toEqual([
      'fill',
      'line',
      'line',
      'circle',
      'symbol',
      'symbol',
      'symbol',
      'fill',
      'line',
      'line',
      'circle',
    ]);
  });

  it('flags the selection copies internal, and nothing else', async () => {
    const { previewer } = await previewGeoJson();
    const internal = previewer.previewLayers[0].styleLayers.filter(styleLayer => styleLayer.internal);

    expect(internal.map(styleLayer => styleLayer.id)).toEqual(SELECTED_SUFFIXES.map(layerId));
  });
});

describe('GeoJsonPreviewer#colors', () => {
  const dataColors = ['case', SELECTED, style.selectedColor, HOVER, style.highlightColor, UNAVAILABLE, style.invalidColor, style.dataColor];
  const strokeColors = ['case', SELECTED, style.strokeSelectedColor, HOVER, style.strokeHighlightColor, UNAVAILABLE, style.strokeInvalidColor, style.strokeColor];

  it('falls back to the invalid data color for a feature marked unavailable, below selected and hover', async () => {
    const { map } = await previewGeoJson();

    expect(map.layers.get(layerId('polygons')).paint['fill-color']).toEqual(dataColors);
  });

  it('does the same for stroke colors, on polygon outlines', async () => {
    const { map } = await previewGeoJson();

    expect(map.layers.get(layerId('polygon-outlines')).paint['line-color']).toEqual(strokeColors);
  });

  it('draws line geometry in the data color, not the stroke color', async () => {
    const { map } = await previewGeoJson();

    expect(map.layers.get(layerId('lines')).paint['line-color']).toEqual(dataColors);
  });

  it('does the same for circle fill and stroke colors', async () => {
    const { map } = await previewGeoJson();

    expect(map.layers.get(layerId('points')).paint['circle-color']).toEqual(dataColors);
    expect(map.layers.get(layerId('points')).paint['circle-stroke-color']).toEqual(strokeColors);
  });
});

describe('GeoJsonPreviewer#applyLayerState', () => {
  const applyOpacity = async (opacity: number) => {
    const { map, previewer } = await previewGeoJson();
    previewer.applyLayerState(new Map([[ROW_ID, { visible: true, opacity }]]));
    return map;
  };

  it('writes opacity into the unselected branch of a fill, leaving the selected feature solid', async () => {
    const map = await applyOpacity(0.5);

    expect(map.layers.get(layerId('polygons')).paint['fill-opacity']).toEqual(['case', SELECTED, 1, 0.5]);
  });

  it('does the same for circles, which are also drawn differently when selected', async () => {
    const map = await applyOpacity(0.5);

    expect(map.layers.get(layerId('points')).paint['circle-opacity']).toEqual(['case', SELECTED, 1, 0.5]);
    expect(map.layers.get(layerId('points')).paint['circle-stroke-opacity']).toEqual(0.5);
  });

  it('writes a plain number where there is no selected state to preserve', async () => {
    const map = await applyOpacity(0.5);

    expect(map.layers.get(layerId('polygon-outlines')).paint['line-opacity']).toEqual(0.5);
    expect(map.layers.get(layerId('lines')).paint['line-opacity']).toEqual(0.5);
    expect(map.layers.get(layerId('point-labels')).paint['text-opacity']).toEqual(0.5);
  });

  it('never writes fill-opacity to a layer that has no fill', async () => {
    const map = await applyOpacity(0.5);

    DRAWN.filter(suffix => !suffix.startsWith('polygons')).forEach(suffix => {
      expect(map.layers.get(layerId(suffix)).paint['fill-opacity']).toBeUndefined();
    });
  });

  it('reproduces the authored paint exactly at the default opacity, so re-applying is a no-op', async () => {
    const { map, previewer } = await previewGeoJson();
    const authored = structuredClone(map.layers.get(layerId('polygons')).paint);

    previewer.applyLayerState(new Map([[ROW_ID, { visible: true, opacity: style.opacity }]]));

    expect(map.layers.get(layerId('polygons')).paint).toEqual(authored);
  });

  it('does not compound when applied repeatedly, as a slider drag does', async () => {
    const { map, previewer } = await previewGeoJson();
    const states = new Map([[ROW_ID, { visible: true, opacity: 0.5 }]]);

    previewer.applyLayerState(states);
    const once = structuredClone(map.layers.get(layerId('polygons')).paint);
    previewer.applyLayerState(states);

    expect(map.layers.get(layerId('polygons')).paint).toEqual(once);
  });

  it('hides every style layer the row draws through, and leaves their paint alone', async () => {
    const { map, previewer } = await previewGeoJson();
    const authored = structuredClone(map.layers.get(layerId('polygons')).paint);

    previewer.applyLayerState(new Map([[ROW_ID, { visible: false, opacity: style.opacity }]]));

    DRAWN.forEach(suffix => expect(map.layers.get(layerId(suffix)).layout.visibility).toEqual('none'));
    expect(map.layers.get(layerId('polygons')).paint).toEqual(authored);
    expect(previewer.layerIds).toEqual(DRAWN.map(layerId));
  });

  it('shows them again when the row comes back', async () => {
    const { map, previewer } = await previewGeoJson();

    previewer.applyLayerState(new Map([[ROW_ID, { visible: false, opacity: style.opacity }]]));
    previewer.applyLayerState(new Map([[ROW_ID, { visible: true, opacity: style.opacity }]]));

    DRAWN.forEach(suffix => expect(map.layers.get(layerId(suffix)).layout.visibility).toEqual('visible'));
  });

  it('hides a row faded all the way out', async () => {
    const map = await applyOpacity(0);

    DRAWN.forEach(suffix => expect(map.layers.get(layerId(suffix)).layout.visibility).toEqual('none'));
  });
});

describe('GeoJsonPreviewer#visibleLayerIds', () => {
  it('offers every style layer for inspection while the row is drawn', async () => {
    const { previewer } = await previewGeoJson();

    expect(previewer.visibleLayerIds).toEqual(SUFFIXES.map(layerId));
    expect(previewer.anyLayerVisible).toBe(true);
  });

  it('offers none once the row is hidden', async () => {
    const { previewer } = await previewGeoJson();
    previewer.applyLayerState(new Map([[ROW_ID, { visible: false, opacity: 1 }]]));

    expect(previewer.visibleLayerIds).toEqual([]);
    expect(previewer.anyLayerVisible).toBe(false);
  });

  it('offers none once the row is faded all the way out', async () => {
    const { previewer } = await previewGeoJson();
    previewer.applyLayerState(new Map([[ROW_ID, { visible: true, opacity: 0 }]]));

    expect(previewer.visibleLayerIds).toEqual([]);
    expect(previewer.anyLayerVisible).toBe(false);
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

    expect([...map.layers.keys()]).toEqual(DRAWN.map(suffix => `princeton-fk4544658v-geojson-indexmap-${suffix}`));
  });

  it('describes its availability and selection colors for a legend', async () => {
    const { previewer } = await previewIndexMap();

    expect(previewer.legendEntries).toEqual([
      { label: 'Available map', color: style.dataColor },
      { label: 'Unavailable map', color: style.invalidColor },
      { label: 'Selected map', color: style.selectedColor },
    ]);
  });

  it('has no legend before it is drawn or after its layer is hidden', async () => {
    const undrawn = new OpenIndexMapPreviewer(new OpenIndexMapResource('princeton-fk4544658v', GEOJSON_URL));
    expect(undrawn.legendEntries).toEqual([]);

    const { previewer } = await previewIndexMap();
    previewer.applyLayerState(new Map([[INDEX_ROW_ID, { visible: false, opacity: style.boundsOpacity }]]));
    expect(previewer.legendEntries).toEqual([]);
  });
});

const INDEX_ROW_ID = 'princeton-fk4544658v-geojson-indexmap';
const LABELS_ROW_ID = `${INDEX_ROW_ID}-labels`;
const indexLayerId = (suffix: string) => `${INDEX_ROW_ID}-${suffix}`;
const GEOMETRY_SUFFIXES = ['polygons', 'polygon-outlines', 'lines', 'points'];
const LABEL_SUFFIXES = ['polygon-labels', 'line-labels', 'point-labels'];

describe('OpenIndexMapPreviewer#opacity', () => {
  it('starts fainter than a GeoJSON document of the same shape', async () => {
    const { previewer } = await previewIndexMap();
    const { previewer: geojson } = await previewGeoJson();

    expect(previewer.previewLayers[0].defaultOpacity).toEqual(style.boundsOpacity);
    expect(geojson.previewLayers[0].defaultOpacity).toEqual(style.opacity);
    expect(style.boundsOpacity).toBeLessThan(style.opacity);
  });

  it('authors every style layer at the opacity its slider starts from', async () => {
    const { map } = await previewIndexMap();
    const faded = ['case', SELECTED, 1, style.boundsOpacity];

    expect(map.layers.get(indexLayerId('polygons')).paint['fill-opacity']).toEqual(faded);
    expect(map.layers.get(indexLayerId('points')).paint['circle-opacity']).toEqual(faded);
    expect(map.layers.get(indexLayerId('points')).paint['circle-stroke-opacity']).toEqual(style.boundsOpacity);
    ['polygon-outlines', 'lines'].forEach(suffix => expect(map.layers.get(indexLayerId(suffix)).paint['line-opacity']).toEqual(style.boundsOpacity));
    LABEL_SUFFIXES.forEach(suffix => expect(map.layers.get(indexLayerId(suffix)).paint['text-opacity']).toEqual(style.opacity));
  });

  it('reproduces the authored paint exactly at its own default, so re-applying is a no-op', async () => {
    const { map, previewer } = await previewIndexMap();
    const authored = DRAWN.map(suffix => structuredClone(map.layers.get(indexLayerId(suffix)).paint));

    previewer.applyLayerState(
      new Map([
        [INDEX_ROW_ID, { visible: true, opacity: style.boundsOpacity }],
        [LABELS_ROW_ID, { visible: true, opacity: style.opacity }],
      ]),
    );

    DRAWN.forEach((suffix, index) => expect(map.layers.get(indexLayerId(suffix)).paint).toEqual(authored[index]));
  });

  it('still takes any opacity the reader asks for', async () => {
    const { map, previewer } = await previewIndexMap();

    previewer.applyLayerState(new Map([[INDEX_ROW_ID, { visible: true, opacity: 1 }]]));

    expect(map.layers.get(indexLayerId('polygons')).paint['fill-opacity']).toEqual(['case', SELECTED, 1, 1]);
  });
});

describe('OpenIndexMapPreviewer#labels', () => {
  it('offers the labels as a second row, painted over the boundaries', async () => {
    const { previewer } = await previewIndexMap();

    expect(previewer.previewLayers.map(layer => layer.id)).toEqual([INDEX_ROW_ID, LABELS_ROW_ID]);
    expect(previewer.previewLayers.map(layer => layer.title)).toEqual(['Geometry', 'Sheet labels']);
  });

  it('splits the style layers between the two rows, leaving none in both or neither', async () => {
    const { previewer } = await previewIndexMap();
    const [boundaries, labels] = previewer.previewLayers;

    expect(boundaries.styleLayers.map(styleLayer => styleLayer.id)).toEqual([...GEOMETRY_SUFFIXES, ...SELECTED_SUFFIXES].map(indexLayerId));
    expect(labels.styleLayers.map(styleLayer => styleLayer.id)).toEqual(LABEL_SUFFIXES.map(indexLayerId));
  });

  it('starts the labels at the theme opacity, not the fainter one the boundaries take', async () => {
    const { previewer } = await previewIndexMap();

    expect(previewer.previewLayers[1].defaultOpacity).toEqual(style.opacity);
    expect(style.boundsOpacity).toBeLessThan(style.opacity);
  });

  it('holds the sheet labels back until a sheet can fit its label', async () => {
    const { map } = await previewIndexMap();

    expect(map.layers.get(indexLayerId('polygon-labels')).minzoom).toEqual(labelMinZoom(DOCUMENT, style.textSize));
    expect(map.layers.get(indexLayerId('polygon-labels')).minzoom).toBeGreaterThan(0);
    expect(map.layers.get(indexLayerId('point-labels')).minzoom).toBeUndefined();
  });

  it('leaves the labels of a plain GeoJSON preview at every zoom', async () => {
    const { map } = await previewGeoJson();

    expect(map.layers.get(layerId('polygon-labels')).minzoom).toBeUndefined();
  });

  it('fades the labels without touching the boundaries, and the boundaries without touching the labels', async () => {
    const { map, previewer } = await previewIndexMap();

    previewer.applyLayerState(
      new Map([
        [INDEX_ROW_ID, { visible: true, opacity: 1 }],
        [LABELS_ROW_ID, { visible: true, opacity: 0.25 }],
      ]),
    );

    expect(map.layers.get(indexLayerId('polygons')).paint['fill-opacity']).toEqual(['case', SELECTED, 1, 1]);
    LABEL_SUFFIXES.forEach(suffix => expect(map.layers.get(indexLayerId(suffix)).paint['text-opacity']).toEqual(0.25));
  });

  it('hides the labels while the boundaries stay drawn', async () => {
    const { map, previewer } = await previewIndexMap();

    previewer.applyLayerState(new Map([[LABELS_ROW_ID, { visible: false, opacity: style.opacity }]]));

    LABEL_SUFFIXES.forEach(suffix => expect(map.layers.get(indexLayerId(suffix)).layout.visibility).toEqual('none'));
    [...GEOMETRY_SUFFIXES, ...SELECTED_SUFFIXES].forEach(suffix => expect(map.layers.get(indexLayerId(suffix)).layout.visibility).toEqual('visible'));
    expect(previewer.visibleLayerIds).toEqual(GEOMETRY_SUFFIXES.map(indexLayerId));
  });

  it('drops the legend once the boundaries are hidden, however many labels are left', async () => {
    const { previewer } = await previewIndexMap();

    previewer.applyLayerState(
      new Map([
        [INDEX_ROW_ID, { visible: false, opacity: style.boundsOpacity }],
        [LABELS_ROW_ID, { visible: true, opacity: style.opacity }],
      ]),
    );

    expect(previewer.legendEntries).toEqual([]);
  });

  it('keeps the legend while the boundaries are drawn and only the labels are hidden', async () => {
    const { previewer } = await previewIndexMap();

    previewer.applyLayerState(new Map([[LABELS_ROW_ID, { visible: false, opacity: style.opacity }]]));

    expect(previewer.legendEntries).toHaveLength(3);
  });
});

describe('GeoJsonPreviewer#labelPriority', () => {
  const LAST_FIRST = ['-', 0, ['id']];

  it('gives a stack’s label to the feature drawn on top of it', async () => {
    const { map } = await previewGeoJson();

    LABEL_SUFFIXES.forEach(suffix => expect(map.layers.get(layerId(suffix)).layout['symbol-sort-key']).toEqual(LAST_FIRST));
  });

  it('labels an index map sheet with the edition drawn on top', async () => {
    const { map } = await previewIndexMap();

    LABEL_SUFFIXES.forEach(suffix => expect(map.layers.get(indexLayerId(suffix)).layout['symbol-sort-key']).toEqual(LAST_FIRST));
  });

  it('leaves the shapes drawn in the order the document lists them', async () => {
    const { map } = await previewGeoJson();

    GEOMETRY_SUFFIXES.forEach(suffix => expect(Object.keys(map.layers.get(layerId(suffix)).layout).filter(key => key.endsWith('-sort-key'))).toEqual([]));
  });
});

describe('GeoJsonPreviewer#labels', () => {
  const NOT_LABEL_POINT = ['!', IS_LABEL_POINT];
  const IS_POINT = ['==', ['geometry-type'], 'Point'];

  it('draws polygon labels at the label points, not over the polygons', async () => {
    const { map } = await previewGeoJson();

    expect(map.layers.get(layerId('polygon-labels')).filter).toEqual(IS_LABEL_POINT);
  });

  it('keeps the label points out of everything that draws the document’s own points', async () => {
    const { map } = await previewGeoJson();

    ['points', 'points-selected', 'point-labels'].forEach(suffix => expect(map.layers.get(layerId(suffix)).filter).toEqual(['all', IS_POINT, NOT_LABEL_POINT]));
  });

  it('labels an index map’s sheets the same way', async () => {
    const { map } = await previewIndexMap();

    expect(map.layers.get(indexLayerId('polygon-labels')).filter).toEqual(IS_LABEL_POINT);
  });

  it('answers a click on a label alone with its sheet’s properties, unmarked', async () => {
    const { previewer } = await previewGeoJson();
    const label = { source: 'princeton-fk4544658v-geojson', id: 0, properties: { label: 'SF 20', [LABEL_POINT]: true } } as unknown as MapGeoJSONFeature;

    const [expanded] = await previewer.expandFeatures([label]);

    expect(expanded.properties).toEqual({ label: 'SF 20' });
    expect([expanded.source, expanded.id]).toEqual([label.source, label.id]);
  });
});

describe('GeoJsonPreviewer#selection', () => {
  const ONLY_SELECTED = ['case', SELECTED, 1, 0];
  const COPIES = [
    ['polygons', 'polygons-selected'],
    ['polygon-outlines', 'polygon-outlines-selected'],
    ['lines', 'lines-selected'],
    ['points', 'points-selected'],
  ];

  const GROUPED_BY = ['type', 'source', 'source-layer', 'minzoom', 'maxzoom', 'filter', 'layout'];

  it('draws each geometry layer a second time, directly over itself', async () => {
    const { map } = await previewGeoJson();
    const order = [...map.layers.keys()];

    COPIES.forEach(([layer, copy]) => expect(order.indexOf(layerId(copy))).toEqual(order.indexOf(layerId(layer)) + 1));
  });

  it('shows nothing in a copy but the selected feature', async () => {
    const { map } = await previewGeoJson();

    expect(map.layers.get(layerId('polygons-selected')).paint['fill-opacity']).toEqual(ONLY_SELECTED);
    expect(map.layers.get(layerId('polygon-outlines-selected')).paint['line-opacity']).toEqual(ONLY_SELECTED);
    expect(map.layers.get(layerId('lines-selected')).paint['line-opacity']).toEqual(ONLY_SELECTED);
    expect(map.layers.get(layerId('points-selected')).paint['circle-opacity']).toEqual(ONLY_SELECTED);
    expect(map.layers.get(layerId('points-selected')).paint['circle-stroke-opacity']).toEqual(ONLY_SELECTED);
  });

  it('draws the selected feature in a copy the way its own layer draws it', async () => {
    const { map } = await previewGeoJson();
    const paint = (suffix: string) => map.layers.get(layerId(suffix)).paint;

    expect(paint('polygons-selected')).toEqual({ ...paint('polygons'), 'fill-opacity': ONLY_SELECTED });
    expect(paint('polygon-outlines-selected')).toEqual({ ...paint('polygon-outlines'), 'line-opacity': ONLY_SELECTED });
    expect(paint('lines-selected')).toEqual({ ...paint('lines'), 'line-opacity': ONLY_SELECTED });
    expect(paint('points-selected')).toEqual({ ...paint('points'), 'circle-opacity': ONLY_SELECTED, 'circle-stroke-opacity': ONLY_SELECTED });
  });

  it('reads exactly the features of the layer it copies', async () => {
    const { map } = await previewGeoJson();

    COPIES.forEach(([layer, copy]) => GROUPED_BY.forEach(key => expect(map.layers.get(layerId(copy))[key]).toEqual(map.layers.get(layerId(layer))[key])));
  });

  it('keeps the selected feature solid at any opacity the row is faded to', async () => {
    const { map, previewer } = await previewGeoJson();

    previewer.applyLayerState(new Map([[ROW_ID, { visible: true, opacity: 0.3 }]]));

    expect(map.layers.get(layerId('polygons-selected')).paint['fill-opacity']).toEqual(ONLY_SELECTED);
    expect(map.layers.get(layerId('polygon-outlines-selected')).paint['line-opacity']).toEqual(ONLY_SELECTED);
    expect(map.layers.get(layerId('points-selected')).paint['circle-stroke-opacity']).toEqual(ONLY_SELECTED);
  });

  it('keeps the copies out of what a click can find', async () => {
    const { previewer } = await previewGeoJson();

    SELECTED_SUFFIXES.forEach(suffix => expect(previewer.visibleLayerIds).not.toContain(layerId(suffix)));
  });

  it('copies an index map sheet the same way', async () => {
    const { map } = await previewIndexMap();

    expect(map.layers.get(indexLayerId('polygons-selected')).paint['fill-opacity']).toEqual(ONLY_SELECTED);
    expect(map.layers.get(indexLayerId('polygon-outlines-selected')).paint['line-color']).toEqual(map.layers.get(indexLayerId('polygon-outlines')).paint['line-color']);
  });
});
