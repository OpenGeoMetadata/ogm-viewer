import { describe, it, expect, beforeEach } from '@stencil/vitest';
import type { MapGeoJSONFeature } from 'maplibre-gl';

import WmsPreviewer from './wms';
import WmsResource from '../resources/wms';
import type { MapLibreStyle } from '../themes/maplibre';

// Just enough of a MapLibre map to record what the previewer adds, removes and draws
class FakeMap {
  sources = new Map<string, { type: string; data?: GeoJSON.GeoJSON }>();
  layers = new Map<string, any>();

  getSource(id: string) {
    const source = this.sources.get(id);
    if (!source) return undefined;
    return { ...source, setData: (data: GeoJSON.GeoJSON) => (source.data = data) };
  }
  addSource(id: string, spec: { type: string; data?: GeoJSON.GeoJSON }) {
    this.sources.set(id, { ...spec });
  }
  removeSource(id: string) {
    this.sources.delete(id);
  }
  getLayer(id: string) {
    return this.layers.get(id);
  }
  addLayer(layer: { id: string; type: string; source: string }) {
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

// The previewer only reads the colors used by the highlight
const style = { opacity: 0.8, strokeSelectedColor: '#0a0', fillSelectedColor: '#0f0', fillHighlightOpacity: 0.8 } as MapLibreStyle;

const TRACT_GEOMETRY: GeoJSON.Geometry = {
  type: 'MultiPolygon',
  coordinates: [
    [
      [
        [-120.4, 38.3],
        [-120.3, 38.3],
        [-120.3, 38.4],
        [-120.4, 38.3],
      ],
    ],
  ],
};

// A tract as GetFeatureInfo returns it, already reprojected to degrees by the caller. These are
// plain objects rather than real MapGeoJSONFeatures, which is also what the caller hands over.
const tract = (id: string, geometry: GeoJSON.Geometry | null = TRACT_GEOMETRY) =>
  ({ type: 'Feature', id, geometry, properties: { TRACT: '0301' } }) as unknown as MapGeoJSONFeature;

const HIGHLIGHT_SOURCE = 's7st30-wms-highlight';

let map: FakeMap;
let previewer: WmsPreviewer;

beforeEach(async () => {
  map = new FakeMap();
  const source = new WmsResource('s7st30', 'https://geoservices.lib.berkeley.edu/geoserver/wms', { layerIds: [] });
  previewer = new WmsPreviewer(source, map as unknown as maplibregl.Map, style);
  await previewer.preview();
});

const HIGHLIGHT_LAYERS = ['s7st30-wms-highlight-outlines', 's7st30-wms-highlight-points'];

describe('WmsPreviewer#previewLayers', () => {
  it('offers the tiles as one row, named for the service', () => {
    expect(previewer.previewLayers).toHaveLength(1);
    expect(previewer.previewLayers[0].id).toEqual('s7st30-wms');
    expect(previewer.previewLayers[0].title).toEqual('Web Map Service (WMS)');
    expect(previewer.previewLayers[0].defaultOpacity).toEqual(0.8);
  });

  // The highlight belongs to the tiles' row rather than one of its own: it's machinery for reading
  // them, not something the user chose to put on the map
  it('carries the highlight layers on that row, flagged as machinery', () => {
    const styleLayers = previewer.previewLayers[0].styleLayers;

    expect(styleLayers.map(styleLayer => styleLayer.id)).toEqual(['s7st30-wms', ...HIGHLIGHT_LAYERS]);
    expect(styleLayers.filter(styleLayer => styleLayer.internal).map(styleLayer => styleLayer.id)).toEqual(HIGHLIGHT_LAYERS);
  });

  // An outline the server drew has to stay legible at exactly the moment the user faded the
  // tiles to see what was under them
  it('never fades the highlight along with the tiles', () => {
    previewer.applyLayerState(new Map([['s7st30-wms', { visible: true, opacity: 0.15 }]]));

    expect(map.layers.get('s7st30-wms').paint['raster-opacity']).toEqual(0.15);

    // The outline never declared an opacity and none was written for it
    expect(map.layers.get('s7st30-wms-highlight-outlines').paint['line-opacity']).toBeUndefined();
    // The point keeps the one it was authored with
    expect(map.layers.get('s7st30-wms-highlight-points').paint['circle-opacity']).toEqual(0.8);
    expect(map.layers.get('s7st30-wms-highlight-points').paint['circle-stroke-opacity']).toBeUndefined();
  });

  it('hides the highlight when the tiles are hidden', () => {
    previewer.applyLayerState(new Map([['s7st30-wms', { visible: false, opacity: 0.8 }]]));

    ['s7st30-wms', ...HIGHLIGHT_LAYERS].forEach(id => expect(map.layers.get(id).layout.visibility).toEqual('none'));
    expect(previewer.anyLayerVisible).toBe(false);
  });

  it('keeps the highlight out of what a click may inspect', () => {
    expect(previewer.visibleLayerIds).toEqual(['s7st30-wms']);
  });
});

describe('WmsPreviewer#preview', () => {
  it('adds a highlight source alongside the tiles', () => {
    expect([...map.sources.keys()]).toEqual(['s7st30-wms-highlight', 's7st30-wms']);
    expect(map.sources.get(HIGHLIGHT_SOURCE)?.type).toEqual('geojson');
  });

  it('draws the highlight over the tiles', () => {
    // Order is paint order: the raster layer first, then the layers that highlight over it
    expect([...map.layers.keys()]).toEqual(['s7st30-wms', 's7st30-wms-highlight-outlines', 's7st30-wms-highlight-points']);
    expect(previewer.layerIds).toEqual([...map.layers.keys()]);
  });

  it('outlines polygons and lines but circles only points', () => {
    const outlines = map.layers.get('s7st30-wms-highlight-outlines');
    const points = map.layers.get('s7st30-wms-highlight-points');

    expect(outlines?.type).toEqual('line');
    expect(points?.type).toEqual('circle');

    // Both draw from the highlight source, not from the tiles
    expect(outlines?.source).toEqual(HIGHLIGHT_SOURCE);
    expect(points?.source).toEqual(HIGHLIGHT_SOURCE);
  });

  it('starts with nothing highlighted', () => {
    expect(map.sources.get(HIGHLIGHT_SOURCE)?.data).toEqual({ type: 'FeatureCollection', features: [] });
  });
});

describe('WmsPreviewer#highlightFeatures', () => {
  it('draws the geometry of the given features', () => {
    previewer.highlightFeatures([tract('s7st30.18')]);
    const data = map.sources.get(HIGHLIGHT_SOURCE)?.data as GeoJSON.FeatureCollection;

    expect(data.features).toHaveLength(1);
    expect(data.features[0].id).toEqual('s7st30.18');
    expect(data.features[0].geometry).toEqual(TRACT_GEOMETRY);
  });

  it('replaces the previous highlight rather than adding to it', () => {
    previewer.highlightFeatures([tract('s7st30.18')]);
    previewer.highlightFeatures([tract('s7st30.19')]);
    const data = map.sources.get(HIGHLIGHT_SOURCE)?.data as GeoJSON.FeatureCollection;

    expect(data.features).toHaveLength(1);
    expect(data.features[0].id).toEqual('s7st30.19');
  });

  it('draws every feature when several are selected', () => {
    previewer.highlightFeatures([tract('s7st30.18'), tract('s7st30.19')]);
    const data = map.sources.get(HIGHLIGHT_SOURCE)?.data as GeoJSON.FeatureCollection;

    expect(data.features.map(feature => feature.id)).toEqual(['s7st30.18', 's7st30.19']);
  });

  it('skips features a server returned without geometry', () => {
    // The spec allows a null geometry, and a server can answer with attributes alone
    previewer.highlightFeatures([tract('s7st30.18'), tract('s7st30.19', null)]);
    const data = map.sources.get(HIGHLIGHT_SOURCE)?.data as GeoJSON.FeatureCollection;

    expect(data.features).toHaveLength(1);
    expect(data.features[0].id).toEqual('s7st30.18');
  });
});

describe('WmsPreviewer#clearHighlight', () => {
  it('empties the highlight source but leaves the layers in place', () => {
    previewer.highlightFeatures([tract('s7st30.18')]);
    previewer.clearHighlight();

    expect(map.sources.get(HIGHLIGHT_SOURCE)?.data).toEqual({ type: 'FeatureCollection', features: [] });
    expect(map.layers.size).toEqual(3);
  });
});

describe('WmsPreviewer#clearPreview', () => {
  it('removes the highlight along with the tiles', async () => {
    previewer.highlightFeatures([tract('s7st30.18')]);
    await previewer.clearPreview();

    expect(map.sources.size).toEqual(0);
    expect(map.layers.size).toEqual(0);
    expect(previewer.layerIds).toEqual([]);
  });

  it('can be previewed again afterwards', async () => {
    await previewer.clearPreview();
    await previewer.preview();

    expect(map.sources.has(HIGHLIGHT_SOURCE)).toBe(true);
    expect(map.layers.size).toEqual(3);
  });
});
