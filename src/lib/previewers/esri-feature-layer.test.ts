import { describe, it, expect, beforeEach, vi } from '@stencil/vitest';

import EsriFeatureLayerPreviewer from './esri-feature-layer';
import type { EsriMetadata } from '../esri';
import EsriFeatureLayerResource from '../resources/esri-feature-layer';
import type { MapLibreStyle } from '../themes/maplibre';

type FakeSource = { type: string; data?: GeoJSON.GeoJSON | string };
type FakeLayer = { 'id': string; 'type': string; 'source': string; 'source-layer'?: string; 'minzoom'?: number; 'maxzoom'?: number };

// Just enough of a MapLibre map to record what the previewer adds and draws, answer where the
// camera is, and hand back the camera events it listens for
class FakeMap {
  sources = new Map<string, FakeSource>();
  layers = new Map<string, FakeLayer>();
  listeners = new Map<string, Set<() => void>>();

  zoom = 12;

  // What a camera fitted to the previewed bounds would settle on; see MapPreviewer.minZoom
  fitZoom: number | undefined = 12;

  getZoom() {
    return this.zoom;
  }

  cameraForBounds() {
    return this.fitZoom === undefined ? undefined : { zoom: this.fitZoom };
  }

  // A fresh handle each time, over the one stored record, so an assertion on sources still reads
  // whatever setData last wrote
  getSource(id: string) {
    const stored = this.sources.get(id);
    if (!stored) return undefined;
    return { ...stored, setData: (data: GeoJSON.GeoJSON) => (stored.data = data) };
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
  fire(type: string) {
    [...(this.listeners.get(type) ?? [])].forEach(listener => listener());
  }
  listenerCount(type: string) {
    return this.listeners.get(type)?.size ?? 0;
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

const LAYER = 'https://example.org/arcgis/rest/services/Landscape_Trees/FeatureServer/0';

const FEATURES: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [{ type: 'Feature', id: 1, geometry: { type: 'Point', coordinates: [-82.44, 35.61] }, properties: { Spp_Code: 'ULPU' } }],
};

// The scales this library's own fixture layer publishes: level 10 and level 20 of the standard
// ArcGIS table, which are MapLibre zooms 9 and 19. See scaleToZoom.
const SCALED: EsriMetadata = {
  minScale: 577790.554289,
  maxScale: 564.248588,
  extent: { xmin: -92.9, ymin: 42.4, xmax: -86.6, ymax: 47.1, spatialReference: { wkid: 4326 } },
};

// Hands over features and a layer description it already has, rather than querying a service
class TestResource extends EsriFeatureLayerResource {
  reads = 0;

  // Whether a click still has anything to ask for, and what it gets when it asks
  slim = false;
  attributes = new Map<string | number, GeoJSON.GeoJsonProperties>();
  attributesFail = false;
  asked: (string | number)[][] = [];

  constructor(
    id: string,
    url: string,
    private description: EsriMetadata = {},
  ) {
    super(id, url);
  }

  async getData() {
    this.reads += 1;
    return FEATURES;
  }

  protected async getMetadata() {
    return this.description;
  }

  async readsAllFields() {
    return !this.slim;
  }

  async getAttributes(objectIds: (string | number)[]) {
    this.asked.push(objectIds);
    if (this.attributesFail) throw new Error('nope');
    return this.attributes;
  }
}

// A feature as queryRenderedFeatures hands one back: its coordinates live behind a getter, so a
// plain spread of one comes out with no geometry at all
class RenderedFeature {
  type = 'Feature' as const;
  _geometry: GeoJSON.Geometry = { type: 'Point', coordinates: [-82.44, 35.61] };

  constructor(
    public id: number,
    public properties: Record<string, unknown>,
    public source = 'trees-esri-feature-layer',
    public sourceLayer: string | undefined = undefined,
  ) {}

  get geometry() {
    return this._geometry;
  }
}

const renderedFeature = (id: number, properties: Record<string, unknown> = { FID: id }) => new RenderedFeature(id, properties) as unknown as maplibregl.MapGeoJSONFeature;

let map: FakeMap;
let resource: TestResource;
let previewer: EsriFeatureLayerPreviewer;

// Draw a preview of a layer described the given way, with the camera wherever the caller wants it
const build = async (description: EsriMetadata = {}, camera: { zoom?: number; fitZoom?: number } = {}) => {
  map = new FakeMap();
  Object.assign(map, camera);
  resource = new TestResource('trees', LAYER, description);
  previewer = new EsriFeatureLayerPreviewer(resource).attach(map as unknown as maplibregl.Map, style);
  await previewer.preview();
};

beforeEach(async () => {
  await build();
});

describe('EsriFeatureLayerPreviewer#preview', () => {
  it('hands MapLibre the features rather than a URL to fetch them from', () => {
    // The query has to be paged, and may need converting, so MapLibre can't fetch it itself
    expect(map.sources.get('trees-esri-feature-layer')?.data).toBe(FEATURES);
  });

  it('keeps its source apart from the one plain GeoJSON in the same record would use', () => {
    expect([...map.sources.keys()]).toEqual(['trees-esri-feature-layer']);
  });

  it('draws the features with the styled vector layers, one set per geometry type', () => {
    expect([...map.layers.keys()]).toEqual([
      'trees-esri-feature-layer-esri-polygons',
      'trees-esri-feature-layer-esri-polygon-outlines',
      'trees-esri-feature-layer-esri-lines',
      'trees-esri-feature-layer-esri-points',
      'trees-esri-feature-layer-esri-polygon-labels',
      'trees-esri-feature-layer-esri-line-labels',
      'trees-esri-feature-layer-esri-point-labels',
    ]);
  });

  it('draws every layer from the one GeoJSON source, with no source layer to name', () => {
    map.layers.forEach(layer => {
      expect(layer.source).toEqual('trees-esri-feature-layer');
      expect(layer['source-layer']).toBeUndefined();
    });
  });

  it('draws a layer with no published scales at every zoom, the way it always did', () => {
    map.layers.forEach(layer => {
      expect(layer.minzoom).toBeUndefined();
      expect(layer.maxzoom).toBeUndefined();
    });
  });
});

describe('EsriFeatureLayerPreviewer with a published scale window', () => {
  it('holds every style layer to the window the service published', async () => {
    await build(SCALED);

    // maxzoom is a zoom above what maxScale converts to: ArcGIS still draws a layer at its
    // maxScale, where MapLibre has already hidden a style layer at its maxzoom
    map.layers.forEach(layer => {
      expect(layer.minzoom).toEqual(9);
      expect(layer.maxzoom).toEqual(20);
    });
  });

  it('reads nothing while the camera is further out than the layer is published for', async () => {
    await build(SCALED, { zoom: 5 });

    expect(resource.reads).toEqual(0);
    expect(map.sources.get('trees-esri-feature-layer')?.data).toEqual({ type: 'FeatureCollection', features: [] });
  });

  it('says to zoom in while the camera is further out than the layer is published for', async () => {
    const notice = vi.fn();
    map = new FakeMap();
    map.zoom = 5;
    previewer = new EsriFeatureLayerPreviewer(new TestResource('trees', LAYER, SCALED)).attach(map as unknown as maplibregl.Map, style);
    previewer.onNotice = notice;
    await previewer.preview();

    expect(notice).toHaveBeenCalledWith(expect.stringContaining('Zoom in'));
  });

  it('says to zoom out while the camera is closer than the layer is published for', async () => {
    const notice = vi.fn();
    map = new FakeMap();
    map.zoom = 21;
    previewer = new EsriFeatureLayerPreviewer(new TestResource('trees', LAYER, SCALED)).attach(map as unknown as maplibregl.Map, style);
    previewer.onNotice = notice;
    await previewer.preview();

    expect(notice).toHaveBeenCalledWith(expect.stringContaining('Zoom out'));
  });

  it('answers for its own drawing while there is nothing to draw', async () => {
    // No visible style layer reads the source out here, so MapLibre never loads a tile of it and
    // never reports one - and the load deadline would expire on a preview doing as it was told
    const drawn = vi.fn();
    map = new FakeMap();
    map.zoom = 5;
    previewer = new EsriFeatureLayerPreviewer(new TestResource('trees', LAYER, SCALED)).attach(map as unknown as maplibregl.Map, style);
    previewer.onDrawn = drawn;
    await previewer.preview();

    expect(previewer.reportsDrawing).toEqual(true);
    expect(drawn).toHaveBeenCalled();
  });

  it('reads the features once the camera reaches the window', async () => {
    await build(SCALED, { zoom: 5 });
    expect(resource.reads).toEqual(0);

    map.zoom = 11;
    map.fire('zoomend');
    await vi.waitFor(() => expect(resource.reads).toEqual(1));

    expect(map.sources.get('trees-esri-feature-layer')?.data).toBe(FEATURES);
  });

  it('leaves one camera listener behind after a theme change draws the same preview again', async () => {
    await build(SCALED, { zoom: 5 });
    expect(map.listenerCount('zoomend')).toEqual(1);

    // What a basemap swap does: the same previewer draws itself into a rebuilt style document,
    // with no clearPreview in between
    await previewer.preview();

    expect(map.listenerCount('zoomend')).toEqual(1);
  });
});

describe('EsriFeatureLayerPreviewer#minZoom', () => {
  it('holds the map to the published floor when the whole layer still fits there', async () => {
    await build(SCALED, { zoom: 10, fitZoom: 11 });

    expect(previewer.minZoom).toEqual(9);
  });

  it('asks for no floor when the layer is wider than its own floor would show', async () => {
    // Wisconsin needs a camera around zoom 5 to fit, and is published from zoom 9 in: a floor here
    // would cost the reader the only view that shows what the record covers
    await build(SCALED, { zoom: 5, fitZoom: 5.5 });

    expect(previewer.minZoom).toBeUndefined();
  });

  it('asks for no floor when the service publishes no scales', async () => {
    expect(previewer.minZoom).toBeUndefined();
  });
});

describe('EsriFeatureLayerPreviewer#expandFeatures', () => {
  it('asks the service for what a slim read left out', async () => {
    resource.slim = true;
    resource.attributes = new Map([[1, { FID: 1, Spp_Code: 'ULPU', tiff_download_url: 'http://example.org/1.tif' }]]);

    const [expanded] = await previewer.expandFeatures([renderedFeature(1)]);

    expect(resource.asked).toEqual([[1]]);
    expect(expanded.properties).toEqual({ FID: 1, Spp_Code: 'ULPU', tiff_download_url: 'http://example.org/1.tif' });
  });

  it('keeps what the map needs to highlight the feature it expanded', async () => {
    resource.slim = true;
    resource.attributes = new Map([[1, { FID: 1, Spp_Code: 'ULPU' }]]);

    const [expanded] = await previewer.expandFeatures([renderedFeature(1)]);

    // The triple setFeatureState works from, and the geometry the highlight is drawn with - which a
    // spread of a rendered feature would have dropped
    expect(expanded.id).toEqual(1);
    expect(expanded.source).toEqual('trees-esri-feature-layer');
    expect(expanded.sourceLayer).toBeUndefined();
    expect(expanded.geometry).toEqual({ type: 'Point', coordinates: [-82.44, 35.61] });
  });

  it('leaves the tile cache alone', async () => {
    resource.slim = true;
    resource.attributes = new Map([[1, { FID: 1, Spp_Code: 'ULPU' }]]);
    const drawn = renderedFeature(1);

    await previewer.expandFeatures([drawn]);

    expect(drawn.properties).toEqual({ FID: 1 });
  });

  it('asks nothing of a layer that was read with every field it has', async () => {
    const drawn = renderedFeature(1);

    expect(await previewer.expandFeatures([drawn])).toEqual([drawn]);
    expect(resource.asked).toEqual([]);
  });

  it('opens the popup on what it has when the service will not answer', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    resource.slim = true;
    resource.attributesFail = true;
    const drawn = renderedFeature(1);

    expect(await previewer.expandFeatures([drawn])).toEqual([drawn]);
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
  });

  it('leaves a feature the service said nothing about as it was', async () => {
    resource.slim = true;
    const drawn = renderedFeature(1);

    expect(await previewer.expandFeatures([drawn])).toEqual([drawn]);
  });
});

describe('EsriFeatureLayerPreviewer#clearPreview', () => {
  it('removes the features and the layers drawing them', async () => {
    await previewer.clearPreview();

    expect(map.sources.size).toEqual(0);
    expect(map.layers.size).toEqual(0);
  });

  it('stops listening for the camera', async () => {
    await build(SCALED, { zoom: 5 });
    await previewer.clearPreview();

    expect(map.listenerCount('zoomend')).toEqual(0);
  });
});
