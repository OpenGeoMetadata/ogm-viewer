import { describe, it, expect, beforeEach, vi } from '@stencil/vitest';

import EsriTiledFeatureLayerPreviewer from './esri-tiled-feature-layer';
import { parseFeatureTileUrl } from '../esri-features';
import type { EsriExtent, EsriMetadata } from '../esri';
import EsriFeatureLayerResource from '../resources/esri-feature-layer';
import type { MapLibreStyle } from '../themes/maplibre';

type FakeSource = { type: string; data?: unknown; tiles?: string[]; minzoom?: number; maxzoom?: number; bounds?: number[] };
type FakeLayer = { 'id': string; 'type': string; 'source': string; 'source-layer'?: string; 'minzoom'?: number; 'maxzoom'?: number };

class FakeMap {
  sources = new Map<string, FakeSource>();
  layers = new Map<string, FakeLayer>();
  listeners = new Map<string, Set<() => void>>();

  zoom = 12;

  getZoom() {
    return this.zoom;
  }

  fire(type: string) {
    [...(this.listeners.get(type) ?? [])].forEach(listener => listener());
  }

  listenerCount(type: string) {
    return this.listeners.get(type)?.size ?? 0;
  }

  getSource(id: string) {
    return this.sources.get(id);
  }
  addSource(id: string, spec: FakeSource) {
    this.sources.set(id, { ...spec });
  }
  removeSource(id: string) {
    this.sources.delete(id);
  }
  getLayer(id: string) {
    return this.layers.get(id);
  }
  addLayer(layer: FakeLayer) {
    if (!this.sources.has(layer.source)) throw new Error(`No source ${layer.source} for layer ${layer.id}`);
    this.layers.set(layer.id, layer);
  }
  removeLayer(id: string) {
    this.layers.delete(id);
  }
  on(type: string, listener: () => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(listener);
    return this;
  }
  once(type: string, listener: () => void) {
    return this.on(type, listener);
  }
  off(type: string, listener: () => void) {
    this.listeners.get(type)?.delete(listener);
    return this;
  }
}

const style = {
  opacity: 0.8,
  dataColor: '#00f',
  highlightColor: '#0ff',
  highlightOpacity: 0.8,
  selectedColor: '#0f0',
  strokeColor: '#000',
  strokeHighlightColor: '#0ff',
  strokeSelectedColor: '#0a0',
  textColor: '#000',
  textFont: 'Noto Sans Regular',
  textSize: 12,
} as MapLibreStyle;

const LAYER = 'https://services.arcgis.com/x/arcgis/rest/services/Wisconsin_Historic_Aerial_Imagery/FeatureServer/0';
const SOURCE = 'wi-esri-feature-layer';

// The Wisconsin layer, as its service describes it: 318,295 points published from level 10 to
// level 20 of the standard ArcGIS scale table
const WISCONSIN: EsriMetadata = {
  geometryType: 'esriGeometryPoint',
  minScale: 577790.554289,
  maxScale: 564.248588,
  maxRecordCount: 2000,
  tileMaxRecordCount: 8000,
  objectIdField: 'OBJECTID',
  supportedQueryFormats: 'JSON, geoJSON, PBF',
  advancedQueryCapabilities: { supportsPagination: true, supportsQueryWithResultType: true },
};

const EXTENT: EsriExtent = { xmin: -92.99, ymin: 42.39, xmax: -86.68, ymax: 47.1, spatialReference: { wkid: 4326 } };

class TestResource extends EsriFeatureLayerResource {
  constructor(
    id: string,
    url: string,
    private description: EsriMetadata = WISCONSIN,
    private size: { count?: number; extent?: EsriExtent } = { count: 318_295, extent: EXTENT },
  ) {
    super(id, url);
  }

  protected async getMetadata() {
    return this.description;
  }

  protected async getQuerySummary() {
    return this.size;
  }

  // Stands in for a tile the service answered at its own per-request limit
  capped?: number;

  get cappedAtZoom() {
    return this.capped;
  }
}

let map: FakeMap;
let resource: TestResource;
let previewer: EsriTiledFeatureLayerPreviewer;

const build = async (description?: EsriMetadata, size?: { count?: number; extent?: EsriExtent }, zoom = 12) => {
  map = new FakeMap();
  map.zoom = zoom;
  resource = new TestResource('wi', LAYER, description, size);
  previewer = new EsriTiledFeatureLayerPreviewer(resource).attach(map as unknown as maplibregl.Map, style);
  await previewer.preview();
};

beforeEach(async () => {
  await build();
});

describe('EsriTiledFeatureLayerPreviewer#preview', () => {
  it('draws from tiles of its own rather than from a collection handed over whole', () => {
    const source = map.sources.get(SOURCE);

    expect(source?.type).toEqual('vector');
    expect(source?.data).toBeUndefined();
    expect(source?.tiles).toHaveLength(1);
  });

  it('addresses its tiles through the protocol that answers for them', () => {
    const url = (map.sources.get(SOURCE)?.tiles ?? [])[0].replace('{z}/{x}/{y}', '10/257/375');

    expect(parseFeatureTileUrl(url)).toMatchObject({ z: 10, x: 257, y: 375 });
  });

  it('keeps the source id the untiled preview of the same layer would use', () => {
    // A layer that grows past what a browser will hold changes how it is drawn, not what it is.
    // The extent outline beside it hangs off the same id, so both come down together.
    expect([...map.sources.keys()]).toEqual([SOURCE, `${SOURCE}-extent`]);
  });

  it('names the source layer its tiles carry, on every style layer', () => {
    const tiled = [...map.layers.values()].filter(layer => layer.source === SOURCE);

    expect(tiled).toHaveLength(7);
    tiled.forEach(layer => expect(layer['source-layer']).toEqual('esri'));
  });

  it('holds the style layers to the scale window the service published', () => {
    [...map.layers.values()]
      .filter(layer => layer.source === SOURCE)
      .forEach(layer => {
        expect(layer.minzoom).toEqual(9);
        expect(layer.maxzoom).toEqual(20);
      });
  });

  it('calls the row in the layers panel what the reference is, not what we named the tiles', () => {
    expect(previewer.previewLayers.map(layer => layer.title)).toEqual(['ArcGIS Feature Layer']);
  });
});

describe('EsriTiledFeatureLayerPreviewer source zooms', () => {
  it('asks for no tile of a zoom the layer is not published for, or too crowded to draw', () => {
    // Level 10 of the ArcGIS table is MapLibre zoom 9, and a mean of 318,295 points over Wisconsin
    // needs zoom 10 before a tile holds few enough to be worth drawing. The higher floor wins.
    expect(map.sources.get(SOURCE)?.minzoom).toEqual(10);
  });

  it('stops cutting tiles where scaling the deepest one up is cheaper than asking for more', () => {
    expect(map.sources.get(SOURCE)?.maxzoom).toEqual(16);
  });

  it('puts a floor under a layer whose service publishes no scale at all', async () => {
    // Most layers publish none, including the largest one in the OpenGeoMetadata corpus
    await build({ ...WISCONSIN, minScale: 0, maxScale: 0 }, { count: 862_441, extent: EXTENT });

    expect(map.sources.get(SOURCE)?.minzoom).toBeGreaterThan(9);
    expect(map.sources.get(SOURCE)?.maxzoom).toEqual(16);
  });

  it('holds the tiles to the layer extent, so no tile of somewhere else is ever asked for', () => {
    expect(map.sources.get(SOURCE)?.bounds).toEqual([-92.99, 42.39, -86.68, 47.1]);
  });

  it('leaves the bounds off a layer that will not say where it is, which MapLibre rejects', async () => {
    await build({ ...WISCONSIN, extent: undefined }, { count: 318_295 });

    expect(map.sources.get(SOURCE)).not.toHaveProperty('bounds');
  });
});

describe('EsriTiledFeatureLayerPreviewer further out than its tiles', () => {
  beforeEach(async () => {
    await build(WISCONSIN, undefined, 5);
  });

  it('draws where the layer is, so a reader told to zoom in can see where to', () => {
    // Wisconsin needs a camera around zoom 5 to fit and its tiles start at 10, so without this the
    // record opens on a blank map with nothing on it saying where the data is
    const outline = map.layers.get(`${SOURCE}-extent-outline`);
    const label = map.layers.get(`${SOURCE}-extent-label`);

    expect(map.sources.get(`${SOURCE}-extent`)?.type).toEqual('geojson');
    expect(outline?.maxzoom).toEqual(10);
    expect(label?.maxzoom).toEqual(10);
  });

  it('says how much there is to zoom in for', () => {
    expect((map.layers.get(`${SOURCE}-extent-label`) as unknown as { layout: { 'text-field': string } }).layout['text-field']).toEqual('Zoom in to see 318,295 features');
  });

  it('keeps the outline out of the layers panel and off the opacity slider', () => {
    // It is machinery for reading the layer, not a layer of its own
    const [row] = previewer.previewLayers;

    expect(row.styleLayers.filter(layer => layer.internal).map(layer => layer.id)).toEqual([`${SOURCE}-extent-outline`, `${SOURCE}-extent-label`]);
    expect(previewer.previewLayers).toHaveLength(1);
  });

  it('says to zoom in, and that it has drawn all it is going to', async () => {
    const notice = vi.fn();
    const drawn = vi.fn();
    map = new FakeMap();
    map.zoom = 5;
    previewer = new EsriTiledFeatureLayerPreviewer(new TestResource('wi', LAYER)).attach(map as unknown as maplibregl.Map, style);
    previewer.onNotice = notice;
    previewer.onDrawn = drawn;
    await previewer.preview();

    expect(previewer.reportsDrawing).toEqual(true);
    expect(notice).toHaveBeenCalledWith(expect.stringContaining('Zoom in'));
    expect(drawn).toHaveBeenCalled();
  });

  it('stops saying it once the camera reaches the tiles', async () => {
    const notice = vi.fn();
    previewer.onNotice = notice;

    map.zoom = 11;
    map.fire('zoomend');

    expect(notice).toHaveBeenLastCalledWith(undefined);
  });

  it('leaves one camera listener behind after a theme change draws it again', async () => {
    expect(map.listenerCount('zoomend')).toEqual(1);

    await previewer.preview();

    expect(map.listenerCount('zoomend')).toEqual(1);
  });
});

describe('EsriTiledFeatureLayerPreviewer when the service cuts a tile short', () => {
  // One dense tile at the zoom a layer starts drawing at is ordinary - one of nine over downtown
  // Columbus - and it stops being true the moment the reader goes further in
  const noticeAt = async (zoom: number, capped: number) => {
    const notice = vi.fn();
    map = new FakeMap();
    map.zoom = zoom;
    resource = new TestResource('wi', LAYER);
    resource.capped = capped;
    previewer = new EsriTiledFeatureLayerPreviewer(resource).attach(map as unknown as maplibregl.Map, style);
    previewer.onNotice = notice;
    await previewer.preview();
    return notice;
  };

  it('says so at the zoom it happened at', async () => {
    expect(await noticeAt(14, 14)).toHaveBeenLastCalledWith(expect.stringContaining('left out'));
  });

  it('stops saying so once the reader is past it, where the tiles fit', async () => {
    expect(await noticeAt(15, 14)).toHaveBeenLastCalledWith(undefined);
  });

  it('still says so further out, where the tiles are no smaller', async () => {
    expect(await noticeAt(13, 14)).toHaveBeenLastCalledWith(expect.stringContaining('left out'));
  });

  it('says nothing for a layer the service answers in full', async () => {
    const notice = vi.fn();
    map = new FakeMap();
    map.zoom = 14;
    previewer = new EsriTiledFeatureLayerPreviewer(new TestResource('wi', LAYER)).attach(map as unknown as maplibregl.Map, style);
    previewer.onNotice = notice;
    await previewer.preview();

    expect(notice).toHaveBeenLastCalledWith(undefined);
  });

  it('answers again once the tiles have landed, not only when the camera stops', async () => {
    // Whether a tile came back short is only known after it comes back, which is after the zoom
    // that asked for it ended - so the camera alone reports it a whole interaction late
    const notice = vi.fn();
    map = new FakeMap();
    map.zoom = 14;
    resource = new TestResource('wi', LAYER);
    previewer = new EsriTiledFeatureLayerPreviewer(resource).attach(map as unknown as maplibregl.Map, style);
    previewer.onNotice = notice;
    await previewer.preview();
    expect(notice).toHaveBeenLastCalledWith(undefined);

    resource.capped = 14;
    map.fire('idle');

    expect(notice).toHaveBeenLastCalledWith(expect.stringContaining('left out'));
  });

  it('stops listening to the map settling when the preview comes down', async () => {
    await build(WISCONSIN, undefined, 14);
    expect(map.listenerCount('idle')).toEqual(1);

    await previewer.clearPreview();

    expect(map.listenerCount('idle')).toEqual(0);
  });
});

describe('EsriTiledFeatureLayerPreviewer#clearPreview', () => {
  it('takes its tiles and the layers drawing them off the map', async () => {
    await previewer.clearPreview();

    expect(map.sources.size).toEqual(0);
    expect(map.layers.size).toEqual(0);
  });

  it('stops listening for the camera', async () => {
    await previewer.clearPreview();

    expect(map.listenerCount('zoomend')).toEqual(0);
  });

  it('stops answering for tiles of a preview that has come down', async () => {
    const url = (map.sources.get(SOURCE)?.tiles ?? [])[0];
    const token = parseFeatureTileUrl(url.replace('{z}/{x}/{y}', '10/257/375'))?.token as string;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await previewer.clearPreview();
    const { esriFeatureTile } = await import('../esri-features');
    const { data } = await esriFeatureTile({ url: `esri-features://${encodeURIComponent(token)}/10/257/375` }, new AbortController());

    expect(data.byteLength).toEqual(0);
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
  });
});
