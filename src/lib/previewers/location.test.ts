import { describe, it, expect } from '@stencil/vitest';
import type { MapLibreMap } from 'maplibre-gl';

import LocationPreviewer, { locationFor, locationsFor } from './location';
import GeoJsonPreviewer from './geojson';
import LocationResource from '../resources/location';
import GeoJsonResource from '../resources/geojson';
import OgmRecord, { type GeoBlacklightSchemaAardvark } from '../record';
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
  strokeColor: '#009',
  textColor: '#000',
  textFont: 'Noto Sans Regular',
  textSize: 12,
  highlightOpacity: 0.8,
  boundsOpacity: 0.5,
} as MapLibreStyle;

const ID = 'stanford-bb021mm7809';
const FILL = `${ID}-location-fill`;
const OUTLINE = `${ID}-location-outline`;

const BOUNDS: [[number, number], [number, number]] = [
  [29.57, -1.47],
  [35.0, 4.23],
];

const COASTLINE: GeoJSON.Geometry = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [10, 0],
      [10, 1],
      [1, 1],
      [1, 10],
      [0, 10],
      [0, 0],
    ],
  ],
};

const preview = async (location: GeoJSON.Geometry | [[number, number], [number, number]], mapStyle: MapLibreStyle = style) => {
  const map = new FakeMap();
  const previewer = new LocationPreviewer(new LocationResource(ID, location)).attach(map as unknown as MapLibreMap, mapStyle);
  await previewer.preview();
  return { map, previewer };
};

describe('LocationResource', () => {
  it('is always reachable, having nothing to reach', async () => {
    const resource = new LocationResource(ID, BOUNDS);

    expect(resource.url).toEqual('');
    expect(await resource.test()).toBe(true);
  });

  it('makes a box out of bounds it is handed', async () => {
    const resource = new LocationResource(ID, BOUNDS);
    const geometry = resource.getGeometry() as GeoJSON.Polygon;

    expect(geometry.type).toEqual('Polygon');
    expect(geometry.coordinates[0]).toHaveLength(5);
    expect(geometry.coordinates[0][0]).toEqual(geometry.coordinates[0][4]);
  });

  it('keeps a shape it is handed rather than squaring it off', async () => {
    const resource = new LocationResource(ID, COASTLINE);

    expect(resource.getGeometry()).toEqual(COASTLINE);
    expect(await resource.getBounds()).toEqual([
      [0, 0],
      [10, 10],
    ]);
  });

  it('points the camera at the box when given one', async () => {
    expect(await new LocationResource(ID, BOUNDS).getBounds()).toEqual([
      [29.57, -1.47],
      [35, 4.23],
    ]);
  });
});

describe('LocationPreviewer#preview', () => {
  it('hands MapLibre the shape itself rather than a URL to fetch', async () => {
    const { map, previewer } = await preview(COASTLINE);
    const source = map.sources.get(`${ID}-location`);

    expect(source.type).toEqual('geojson');
    expect(source.data.geometry).toEqual(COASTLINE);
    expect(previewer.sourceIds).toEqual([`${ID}-location`]);
  });

  it('draws the extent as an outline with a wash inside it', async () => {
    const { map } = await preview(BOUNDS);

    expect([...map.layers.keys()]).toEqual([FILL, OUTLINE]);
    expect(map.layers.get(OUTLINE).paint['line-color']).toEqual(style.strokeColor);
    expect(map.layers.get(OUTLINE).paint['line-opacity']).toEqual(style.boundsOpacity);
    expect(map.layers.get(FILL).paint['fill-color']).toEqual(style.dataColor);
    expect(map.layers.get(FILL).paint['fill-opacity']).toBeLessThan(style.boundsOpacity);
  });

  it('starts at the opacity for bounds rather than the one for data', async () => {
    const { map, previewer } = await preview(BOUNDS);

    expect(previewer.previewLayers[0].defaultOpacity).toEqual(style.boundsOpacity);
    expect(style.boundsOpacity).toBeLessThan(style.opacity);
    expect(map.layers.get(OUTLINE).paint['line-opacity']).toEqual(style.boundsOpacity);
  });

  it('authors its paint at the opacity its slider starts from', async () => {
    const { map, previewer } = await preview(BOUNDS);
    const authored = { fill: structuredClone(map.layers.get(FILL).paint), outline: structuredClone(map.layers.get(OUTLINE).paint) };

    previewer.applyLayerState(new Map([[`${ID}-location`, { visible: true, opacity: previewer.previewLayers[0].defaultOpacity }]]));

    expect(map.layers.get(FILL).paint).toEqual(authored.fill);
    expect(map.layers.get(OUTLINE).paint).toEqual(authored.outline);
  });

  it('offers the extent as a single row in the layer panel', async () => {
    const { previewer } = await preview(BOUNDS);

    expect(previewer.previewLayers).toHaveLength(1);
    expect(previewer.previewLayers[0].title).toEqual('Location');
    expect(previewer.previewLayers[0].styleLayers.map(layer => layer.id)).toEqual([FILL, OUTLINE]);
  });

  it('removes what it added when cleared', async () => {
    const { map, previewer } = await preview(BOUNDS);
    await previewer.clearPreview();

    expect(map.sources.size).toEqual(0);
    expect(map.layers.size).toEqual(0);
  });
});

describe('LocationPreviewer opacity', () => {
  it('keeps the wash under the outline at whatever opacity is asked for', async () => {
    const { map, previewer } = await preview(BOUNDS);
    const fillAt = (opacity: number) => {
      previewer.applyLayerState(new Map([[`${ID}-location`, { visible: true, opacity }]]));
      return map.layers.get(FILL).paint['fill-opacity'];
    };

    expect(fillAt(0.6)).toBeLessThan(0.6);
    expect(fillAt(0.3)).toBeCloseTo(fillAt(0.6) / 2);
  });

  it('keeps the wash under the outline even where the theme asks for a full-strength extent', async () => {
    const { map } = await preview(BOUNDS, { ...style, boundsOpacity: 1 } as MapLibreStyle);

    expect(map.layers.get(OUTLINE).paint['line-opacity']).toEqual(1);
    expect(map.layers.get(FILL).paint['fill-opacity']).toBeLessThan(1);
  });
});

describe('LocationPreviewer inspection', () => {
  it('says it has nothing to be asked about', async () => {
    const { previewer } = await preview(BOUNDS);

    expect(previewer.inspectable).toBe(false);
  });

  it('is the only previewer that says so', async () => {
    const geojson = new GeoJsonPreviewer(new GeoJsonResource(ID, 'https://example.com/data.json'));

    expect(geojson.inspectable).toBe(true);
  });

  it('still reports its layers as drawn and dimmable', async () => {
    const { map, previewer } = await preview(BOUNDS);

    expect(previewer.visibleLayerIds).toEqual([FILL, OUTLINE]);
    expect(previewer.anyLayerVisible).toBe(true);

    previewer.applyLayerState(new Map([[`${ID}-location`, { visible: true, opacity: 0.6 }]]));
    expect(map.layers.get(OUTLINE).paint['line-opacity']).toEqual(0.6);
    expect(map.layers.get(FILL).paint['fill-opacity']).toBeLessThan(0.6);
  });

  it('hides both layers together when switched off', async () => {
    const { map, previewer } = await preview(BOUNDS);
    previewer.applyLayerState(new Map([[`${ID}-location`, { visible: false, opacity: 0.8 }]]));

    expect(map.layers.get(FILL).layout.visibility).toEqual('none');
    expect(map.layers.get(OUTLINE).layout.visibility).toEqual('none');
    expect(previewer.visibleLayerIds).toEqual([]);
  });
});

describe('locationFor', () => {
  const record = (fields: Partial<GeoBlacklightSchemaAardvark>) =>
    new OgmRecord({
      id: 'a-record',
      dct_title_s: 'A record',
      gbl_resourceClass_sm: ['Datasets'],
      dct_accessRights_s: 'Public',
      gbl_mdVersion_s: 'Aardvark',
      ...fields,
    } as GeoBlacklightSchemaAardvark);

  it('says where one record is', async () => {
    const location = locationFor(record({ dcat_bbox: 'ENVELOPE(29.57,35.0,4.23,-1.47)' }));

    expect(location).toBeInstanceOf(LocationPreviewer);
    expect(await location!.getBounds()).toEqual([
      [29.57, -1.47],
      [35, 4.23],
    ]);
  });

  it('has nothing to say about a record that does not say where it is', () => {
    expect(locationFor(record({}))).toBeUndefined();
  });
});

describe('locationsFor', () => {
  const record = (fields: Partial<GeoBlacklightSchemaAardvark>) =>
    new OgmRecord({
      id: 'a-record',
      dct_title_s: 'A record',
      gbl_resourceClass_sm: ['Datasets'],
      dct_accessRights_s: 'Public',
      gbl_mdVersion_s: 'Aardvark',
      ...fields,
    } as GeoBlacklightSchemaAardvark);

  it('says where each record it is given is', async () => {
    const [location] = locationsFor([record({ dcat_bbox: 'ENVELOPE(29.57,35.0,4.23,-1.47)' })]);

    expect(location).toBeInstanceOf(LocationPreviewer);
    expect(await location!.getBounds()).toEqual([
      [29.57, -1.47],
      [35, 4.23],
    ]);
  });

  it('prefers a record’s own shape to its bounding box', async () => {
    const [location] = locationsFor([record({ locn_geometry: 'POLYGON((0 0,10 0,10 1,1 1,1 10,0 10,0 0))', dcat_bbox: 'ENVELOPE(0,10,10,0)' })]);

    expect((location as any).resource.getGeometry().coordinates[0]).toHaveLength(7);
  });

  it('keeps the place of a record it has nowhere to put', () => {
    const locations = locationsFor([record({ dcat_bbox: 'ENVELOPE(0,10,10,0)' }), record({}), record({ dcat_bbox: 'ENVELOPE(20,30,10,0)' })]);

    expect(locations).toHaveLength(3);
    expect(locations[1]).toBeUndefined();
  });

  it('has nothing to say about no records at all', () => {
    expect(locationsFor([])).toEqual([]);
  });
});
