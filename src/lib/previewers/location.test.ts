import { describe, it, expect } from '@stencil/vitest';

import LocationPreviewer from './location';
import GeoJsonPreviewer from './geojson';
import LocationResource from '../resources/location';
import GeoJsonResource from '../resources/geojson';
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

// boundsOpacity is deliberately not a round fraction of opacity: an assertion that happened to
// hold for either value would say nothing about which one an extent is drawn at
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

// Uganda, roughly: the bounding box sul-embed hands over for a restricted record
const BOUNDS: [[number, number], [number, number]] = [
  [29.57, -1.47],
  [35.0, 4.23],
];

// A shape that is emphatically not its own envelope, for the cases about preferring one
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
  const previewer = new LocationPreviewer(new LocationResource(ID, location)).attach(map as unknown as maplibregl.Map, mapStyle);
  await previewer.preview();
  return { map, previewer };
};

describe('LocationResource', () => {
  // The only resource with nowhere to go. The base class would HEAD its empty URL and report the
  // record broken, which is the opposite of what this is for.
  it('is always reachable, having nothing to reach', async () => {
    const resource = new LocationResource(ID, BOUNDS);

    expect(resource.url).toEqual('');
    expect(await resource.test()).toBe(true);
  });

  it('makes a box out of bounds it is handed', async () => {
    const resource = new LocationResource(ID, BOUNDS);
    const geometry = resource.getGeometry() as GeoJSON.Polygon;

    expect(geometry.type).toEqual('Polygon');
    // Closed ring, five points for four corners
    expect(geometry.coordinates[0]).toHaveLength(5);
    expect(geometry.coordinates[0][0]).toEqual(geometry.coordinates[0][4]);
  });

  // The reason a geometry is worth accepting at all: squaring this off would claim the whole
  // quadrant when the record covers two arms of it.
  it('keeps a shape it is handed rather than squaring it off', async () => {
    const resource = new LocationResource(ID, COASTLINE);

    expect(resource.getGeometry()).toEqual(COASTLINE);
    // Still points the camera at the whole thing
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
    // Held under the outline, so the extent reads as a note about the map and not as data on it
    expect(map.layers.get(FILL).paint['fill-opacity']).toBeLessThan(style.boundsOpacity);
  });

  // An extent is a statement about where to look, not something a reader came for, so it starts
  // fainter than data drawn from the record would - and fainter than the theme's own opacity, which
  // is what every previewer of actual geometry starts at.
  it('starts at the opacity for bounds rather than the one for data', async () => {
    const { map, previewer } = await preview(BOUNDS);

    expect(previewer.previewLayers[0].defaultOpacity).toEqual(style.boundsOpacity);
    expect(style.boundsOpacity).toBeLessThan(style.opacity);
    expect(map.layers.get(OUTLINE).paint['line-opacity']).toEqual(style.boundsOpacity);
  });

  // The slider's starting position and the paint the layers are authored with are the same number.
  // If they drift apart, an extent is drawn at one strength and then immediately redrawn at another,
  // since ogm-map applies the resolved layer state as soon as the preview is on the map.
  it('authors its paint at the opacity its slider starts from', async () => {
    const { map, previewer } = await preview(BOUNDS);
    const authored = { fill: structuredClone(map.layers.get(FILL).paint), outline: structuredClone(map.layers.get(OUTLINE).paint) };

    previewer.applyLayerState(new Map([[`${ID}-location`, { visible: true, opacity: previewer.previewLayers[0].defaultOpacity }]]));

    expect(map.layers.get(FILL).paint).toEqual(authored.fill);
    expect(map.layers.get(OUTLINE).paint).toEqual(authored.outline);
  });

  // One thing the reader can turn off, not two. The outline and the wash are how an extent is drawn.
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
  // A reader dragging the slider down is asking to see more of the basemap, which is the fill's
  // business and not the outline's, so the wash is held under the outline at every setting rather
  // than only at the one it was authored with.
  it('keeps the wash under the outline at whatever opacity is asked for', async () => {
    const { map, previewer } = await preview(BOUNDS);
    const fillAt = (opacity: number) => {
      previewer.applyLayerState(new Map([[`${ID}-location`, { visible: true, opacity }]]));
      return map.layers.get(FILL).paint['fill-opacity'];
    };

    expect(fillAt(0.6)).toBeLessThan(0.6);
    // Scales with the row rather than being clamped somewhere: half the opacity, half the wash
    expect(fillAt(0.3)).toBeCloseTo(fillAt(0.6) / 2);
  });

  // Why the fill's share of the opacity stays a private constant here instead of joining the theme.
  // An app raising --ogm-bounds-opacity is asking for a bolder extent, not for the wash to come
  // up to the strength of the outline and read as data someone drew over the map.
  it('keeps the wash under the outline even where the theme asks for a full-strength extent', async () => {
    const { map } = await preview(BOUNDS, { ...style, boundsOpacity: 1 } as MapLibreStyle);

    expect(map.layers.get(OUTLINE).paint['line-opacity']).toEqual(1);
    expect(map.layers.get(FILL).paint['fill-opacity']).toBeLessThan(1);
  });
});

describe('LocationPreviewer inspection', () => {
  // The whole point of this being its own previewer rather than a GeoJSON one over a hand-built
  // document: <ogm-map> asks the previewer before it queries, and a box with no properties behind it
  // would otherwise open an attributes popup on an empty table.
  it('says it has nothing to be asked about', async () => {
    const { previewer } = await preview(BOUNDS);

    expect(previewer.inspectable).toBe(false);
  });

  it('is the only previewer that says so', async () => {
    const geojson = new GeoJsonPreviewer(new GeoJsonResource(ID, 'https://example.com/data.json'));

    expect(geojson.inspectable).toBe(true);
  });

  // Not achieved by hiding the layers: they are drawn, listed and dimmable like any others. Only
  // the answer to "can this be asked" differs, which is why it isn't PreviewStyleLayer.internal -
  // that would also take the row out of the panel and the layer out of the opacity slider's reach.
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
