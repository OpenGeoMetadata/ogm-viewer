import { describe, it, expect, vi, afterEach } from '@stencil/vitest';
import { LngLatBounds } from 'maplibre-gl';

import EsriDynamicMapLayerResource from './esri-dynamic-map-layer';
import type { EsriMetadata } from '../esri';
import type { PixelWindow } from '../geometry';

const SERVICE = 'https://example.org/arcgis/rest/services/Geology/Glacial_Boundaries/MapServer';

// A 51x51 pixel window ten meters to a pixel, clicked in the middle
const WINDOW: PixelWindow = { bbox: '-10000,0,-9490,510', width: 51, height: 51, x: 25, y: 25 };

// Reads a hand-built service description instead of fetching one, and exposes the identify params
class TestResource extends EsriDynamicMapLayerResource {
  stub: EsriMetadata = {};

  protected async getMetadata() {
    return this.stub;
  }

  paramsFor(window: PixelWindow) {
    return this.identifyParams(window);
  }
}

const resourceFor = (url = SERVICE, stub: EsriMetadata = {}, bounds?: LngLatBounds) => {
  const resource = new TestResource('glacial-boundaries', url, bounds);
  resource.stub = stub;
  return resource;
};

describe('EsriDynamicMapLayerResource#getMapLibreSourceUrl', () => {
  it('renders through the export endpoint, leaving the bbox for MapLibre to fill in', () => {
    const url = resourceFor().getMapLibreSourceUrl();

    expect(url).toContain(`${SERVICE}/export?`);

    // MapLibre has to see the braces to substitute the bbox, so this one can't be encoded
    expect(url).toContain('&bbox={bbox-epsg-3857}');
  });

  it('asks for a transparent Web Mercator image at the tile size MapLibre expects', () => {
    const params = new URL(resourceFor().getMapLibreSourceUrl()).searchParams;

    expect(params.get('bboxSR')).toEqual('3857');
    expect(params.get('imageSR')).toEqual('3857');
    expect(params.get('size')).toEqual('256,256');
    expect(params.get('transparent')).toEqual('true');
    expect(params.get('format')).toEqual('png32');
    expect(params.get('f')).toEqual('image');
  });

  it('draws only the layer a reference names, and drops it from the service URL', () => {
    const url = resourceFor(`${SERVICE}/0`).getMapLibreSourceUrl();

    expect(url).toContain(`${SERVICE}/export?`);
    expect(new URL(url).searchParams.get('layers')).toEqual('show:0');
  });

  it('leaves the visible layers to the service when a reference names none', () => {
    expect(new URL(resourceFor().getMapLibreSourceUrl()).searchParams.get('layers')).toBeNull();
  });
});

describe('EsriDynamicMapLayerResource#getRasterSourceSpec', () => {
  it('is a single templated tile URL at the export size', async () => {
    const spec = await resourceFor().getRasterSourceSpec();

    expect(spec.tiles).toHaveLength(1);
    expect(spec.tileSize).toEqual(256);
    expect(spec.scheme).toBeUndefined();
  });
});

describe('EsriDynamicMapLayerResource#getBounds', () => {
  it('uses the extent the service reports', async () => {
    const stub = { fullExtent: { xmin: -91.5, ymin: 36.9, xmax: -87.4, ymax: 42.5, spatialReference: { wkid: 4326 } } };
    const bounds = (await resourceFor(SERVICE, stub).getBounds()) as LngLatBounds;

    expect(bounds.getWest()).toEqual(-91.5);
    expect(bounds.getNorth()).toEqual(42.5);
  });

  it('prefers the bounds the record carried', async () => {
    const recordBounds = new LngLatBounds([-100, 30], [-90, 40]);
    const stub = { fullExtent: { xmin: -91.5, ymin: 36.9, xmax: -87.4, ymax: 42.5, spatialReference: { wkid: 4326 } } };

    expect(await resourceFor(SERVICE, stub, recordBounds).getBounds()).toBe(recordBounds);
  });

  it('has no bounds when the service reports an extent we cannot convert', async () => {
    const stub = { fullExtent: { xmin: 189000, ymin: 4800000, xmax: 761000, ymax: 5472000, spatialReference: { wkid: 26915 } } };
    expect(await resourceFor(SERVICE, stub).getBounds()).toBeUndefined();
  });
});

describe('EsriDynamicMapLayerResource#canInspect', () => {
  it('is true when the service publishes the Query capability', async () => {
    expect(await resourceFor(SERVICE, { capabilities: 'Map,Query,Data' }).canInspect()).toBe(true);
  });

  it('is false for a service that only hands back its tiles', async () => {
    expect(await resourceFor(SERVICE, { capabilities: 'Map,TilesOnly' }).canInspect()).toBe(false);
  });

  it('is false when the service lists no capabilities', async () => {
    expect(await resourceFor().canInspect()).toBe(false);
  });
});

describe('EsriDynamicMapLayerResource#identifyParams', () => {
  it('asks about the coordinate at the middle of the clicked pixel', () => {
    const params = resourceFor().paramsFor(WINDOW);

    // The window spans 510m over 51 pixels, so the middle of pixel 25 is 255m in from each edge
    expect(JSON.parse(params.geometry)).toEqual({ x: -9745, y: 255, spatialReference: { wkid: 3857 } });
    expect(params.geometryType).toEqual('esriGeometryPoint');
    expect(params.sr).toEqual('3857');
  });

  it('describes the map the click landed on, so the service can scale the tolerance', () => {
    const params = resourceFor().paramsFor(WINDOW);

    expect(params.mapExtent).toEqual(WINDOW.bbox);
    expect(params.imageDisplay).toEqual('51,51,96');
    expect(Number(params.tolerance)).toBeGreaterThan(0);
  });

  it('asks for geometry simplified to the detail the map can show', () => {
    // A pixel of the window is ten meters across, so finer vertices than that are wasted
    expect(Number(resourceFor().paramsFor(WINDOW).maxAllowableOffset)).toEqual(10);
  });

  it('reaches layers the service does not draw by default', () => {
    expect(resourceFor().paramsFor(WINDOW).layers).toEqual('all');
    expect(resourceFor(`${SERVICE}/0`).paramsFor(WINDOW).layers).toEqual('all:0');
  });
});

describe('EsriDynamicMapLayerResource#inspect', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('converts the identify results into features, keeping their attributes', async () => {
    const results = [
      {
        layerName: 'IL_Glacial_Bndys_Py',
        attributes: { EPISODE: 'Wisconsin' },
        geometry: {
          rings: [
            [
              [0, 0],
              [0, 10],
              [10, 10],
              [10, 0],
              [0, 0],
            ],
          ],
        },
      },
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ results }) }));

    const features = await resourceFor().inspect(WINDOW);

    expect(features).toHaveLength(1);
    expect(features[0].properties).toEqual({ EPISODE: 'Wisconsin' });
    expect(features[0].geometry.type).toEqual('Polygon');
  });

  it('has no features when the service drew nothing there', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ results: [] }) }));
    expect(await resourceFor().inspect(WINDOW)).toEqual([]);
  });
});
