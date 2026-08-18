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

// Distinct values for every color so a wrong branch in a case expression shows up as a mismatch
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
  // Distinct from opacity for the same reason the colors are distinct from each other: an index map
  // drawn at the wrong one of the two has to show up as a mismatch
  boundsOpacity: 0.5,
} as MapLibreStyle;

const GEOJSON_URL = 'https://example.com/index-map.json';

// Nothing here fetches: the source URL and the layer names are known without reading the document
const previewGeoJson = async () => {
  const map = new FakeMap();
  const previewer = new GeoJsonPreviewer(new GeoJsonResource('princeton-fk4544658v', GEOJSON_URL)).attach(map as unknown as maplibregl.Map, style);
  await previewer.preview();
  return { map, previewer };
};

const previewIndexMap = async () => {
  const map = new FakeMap();
  const previewer = new OpenIndexMapPreviewer(new OpenIndexMapResource('princeton-fk4544658v', GEOJSON_URL)).attach(map as unknown as maplibregl.Map, style);
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

  // What a theme change leaves behind: setStyle() empties the style document, and the same
  // previewer is asked to draw itself into the new one. What it says it put there has to describe
  // the document in front of it, not every document it has ever drawn into - a second copy of a
  // row would show the user the same layer twice in the layers panel.
  it('draws again into an emptied style without doubling what it says it added', async () => {
    const { map, previewer } = await previewGeoJson();

    map.sources.clear();
    map.layers.clear();
    await previewer.preview();

    expect(previewer.sourceIds).toEqual(['princeton-fk4544658v-geojson']);
    expect(previewer.layerIds).toEqual(SUFFIXES.map(suffix => `princeton-fk4544658v-geojson-geojson-${suffix}`));
    expect(previewer.previewLayers).toHaveLength(1);
    expect(map.layers.size).toEqual(SUFFIXES.length);
  });
});

const ROW_ID = 'princeton-fk4544658v-geojson-geojson';
const layerId = (suffix: string) => `princeton-fk4544658v-geojson-geojson-${suffix}`;
const SELECTED = ['boolean', ['feature-state', 'selected'], false];
const HOVER = ['boolean', ['feature-state', 'hover'], false];
const UNAVAILABLE = ['==', ['get', 'available'], false];

describe('GeoJsonPreviewer#previewLayers', () => {
  it('offers the user one layer, not the seven it takes to draw it', async () => {
    const { previewer } = await previewGeoJson();

    expect(previewer.previewLayers).toHaveLength(1);
    expect(previewer.previewLayers[0].id).toEqual(ROW_ID);
    expect(previewer.previewLayers[0].title).toEqual('GeoJSON');
    expect(previewer.previewLayers[0].defaultOpacity).toEqual(style.opacity);
    expect(previewer.previewLayers[0].styleLayers.map(styleLayer => styleLayer.id)).toEqual(SUFFIXES.map(layerId));
  });

  it('records the type of each style layer, since that decides which paint property carries opacity', async () => {
    const { previewer } = await previewGeoJson();

    expect(previewer.previewLayers[0].styleLayers.map(styleLayer => styleLayer.type)).toEqual(['fill', 'line', 'line', 'circle', 'symbol', 'symbol', 'symbol']);
  });

  it('names an index map after the resource, not the layer id we invented for it', async () => {
    const { previewer } = await previewIndexMap();

    expect(previewer.previewLayers.map(layer => layer.title)).toEqual(['Index Map']);
  });
});

// A feature's availability is static data already on the GeoJSON, not feature-state, so it reads
// straight off ['get', 'available'] - but it still has to rank below selected/hover, or hovering
// an unavailable feature would give no visual feedback at all
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

  // A LineString is the thing being shown, the way a polygon's fill is - not the edge of something
  // else - so it takes the data color rather than the one reserved for outlines
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

  // The one assertion that matters most here: a flat number written over this expression would
  // silently take the selection highlight with it, and no test of a plain value would notice
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

  // The bug in the setOpacity this replaced: it wrote fill-opacity to all seven layers, six of
  // which have no such paint property
  it('never writes fill-opacity to a layer that has no fill', async () => {
    const map = await applyOpacity(0.5);

    SUFFIXES.filter(suffix => suffix !== 'polygons').forEach(suffix => {
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

    SUFFIXES.forEach(suffix => expect(map.layers.get(layerId(suffix)).layout.visibility).toEqual('none'));
    expect(map.layers.get(layerId('polygons')).paint).toEqual(authored);
    expect(previewer.layerIds).toEqual(SUFFIXES.map(layerId));
  });

  it('shows them again when the row comes back', async () => {
    const { map, previewer } = await previewGeoJson();

    previewer.applyLayerState(new Map([[ROW_ID, { visible: false, opacity: style.opacity }]]));
    previewer.applyLayerState(new Map([[ROW_ID, { visible: true, opacity: style.opacity }]]));

    SUFFIXES.forEach(suffix => expect(map.layers.get(layerId(suffix)).layout.visibility).toEqual('visible'));
  });

  // Zero opacity has to hide the layer rather than just make it invisible, or a user could still
  // click a feature they can't see
  it('hides a row faded all the way out', async () => {
    const map = await applyOpacity(0);

    SUFFIXES.forEach(suffix => expect(map.layers.get(layerId(suffix)).layout.visibility).toEqual('none'));
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

    expect([...map.layers.keys()]).toEqual(SUFFIXES.map(suffix => `princeton-fk4544658v-geojson-indexmap-${suffix}`));
  });
});

const INDEX_ROW_ID = 'princeton-fk4544658v-geojson-indexmap';
const indexLayerId = (suffix: string) => `${INDEX_ROW_ID}-${suffix}`;

// An index map's polygons are sheet boundaries: where to find the scans rather than data anyone came
// to read, and they tile the whole extent, so drawn at the strength of real geometry there is no
// basemap left to place them against. It gets the theme's opacity for bounds instead, the same one a
// bounding box gets.
describe('OpenIndexMapPreviewer#opacity', () => {
  it('starts fainter than a GeoJSON document of the same shape', async () => {
    const { previewer } = await previewIndexMap();
    const { previewer: geojson } = await previewGeoJson();

    expect(previewer.previewLayers[0].defaultOpacity).toEqual(style.boundsOpacity);
    expect(geojson.previewLayers[0].defaultOpacity).toEqual(style.opacity);
    expect(style.boundsOpacity).toBeLessThan(style.opacity);
  });

  // Authored at that opacity, not merely defaulted to it. ogm-map applies the resolved layer state as
  // soon as the preview is on the map, so a row authored at one opacity and defaulted to another is
  // drawn at full strength and then immediately redrawn fainter.
  it('authors every style layer at the opacity its slider starts from', async () => {
    const { map } = await previewIndexMap();
    const faded = ['case', SELECTED, 1, style.boundsOpacity];

    expect(map.layers.get(indexLayerId('polygons')).paint['fill-opacity']).toEqual(faded);
    expect(map.layers.get(indexLayerId('points')).paint['circle-opacity']).toEqual(faded);
    expect(map.layers.get(indexLayerId('points')).paint['circle-stroke-opacity']).toEqual(style.boundsOpacity);
    ['polygon-outlines', 'lines'].forEach(suffix => expect(map.layers.get(indexLayerId(suffix)).paint['line-opacity']).toEqual(style.boundsOpacity));
    ['polygon-labels', 'line-labels', 'point-labels'].forEach(suffix => expect(map.layers.get(indexLayerId(suffix)).paint['text-opacity']).toEqual(style.boundsOpacity));
  });

  it('reproduces the authored paint exactly at its own default, so re-applying is a no-op', async () => {
    const { map, previewer } = await previewIndexMap();
    const authored = SUFFIXES.map(suffix => structuredClone(map.layers.get(indexLayerId(suffix)).paint));

    previewer.applyLayerState(new Map([[INDEX_ROW_ID, { visible: true, opacity: style.boundsOpacity }]]));

    SUFFIXES.forEach((suffix, index) => expect(map.layers.get(indexLayerId(suffix)).paint).toEqual(authored[index]));
  });

  // The lower start is where the row begins, not a ceiling on it: someone who wants to read the
  // sheet boundaries closely can still bring them all the way up.
  it('still takes any opacity the reader asks for', async () => {
    const { map, previewer } = await previewIndexMap();

    previewer.applyLayerState(new Map([[INDEX_ROW_ID, { visible: true, opacity: 1 }]]));

    expect(map.layers.get(indexLayerId('polygons')).paint['fill-opacity']).toEqual(['case', SELECTED, 1, 1]);
    expect(map.layers.get(indexLayerId('polygon-labels')).paint['text-opacity']).toEqual(1);
  });
});

// MapLibre validates a style layer as it is added and returns without adding one it rejects - a paint
// color it can't parse, a property the layer type doesn't define - rather than throwing. So a preview
// can hand over all seven of its layers, be told nothing, and have none of them drawn. What the style
// document actually holds is the only witness to that.
describe('GeoJsonPreviewer#droppedLayerIds', () => {
  // A map that refuses the layers it is named, the way MapLibre refuses one that doesn't validate:
  // nothing added, nothing thrown.
  class RefusingMap extends FakeMap {
    constructor(readonly refused: string[]) {
      super();
    }

    addLayer(layer: any) {
      if (this.refused.includes(layer.id)) return;
      super.addLayer(layer);
    }
  }

  it('names the layers the style refused, out of everything it was given', async () => {
    const map = new RefusingMap([layerId('polygons'), layerId('point-labels')]);
    const previewer = new GeoJsonPreviewer(new GeoJsonResource('princeton-fk4544658v', GEOJSON_URL)).attach(map as unknown as maplibregl.Map, style);

    await previewer.preview();

    // Still recorded as asked for, since clearPreview has to look for every one of them
    expect(previewer.layerIds).toEqual(SUFFIXES.map(layerId));
    expect(previewer.droppedLayerIds).toEqual([layerId('polygons'), layerId('point-labels')]);
  });

  it('is empty when the style holds everything it was given', async () => {
    const { previewer } = await previewGeoJson();

    expect(previewer.droppedLayerIds).toEqual([]);
  });
});
