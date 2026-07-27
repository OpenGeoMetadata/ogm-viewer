import { describe, it, expect, vi, afterEach } from '@stencil/vitest';

import EsriImageMapLayerResource from './esri-image-map-layer';
import type { EsriMetadata } from '../esri';
import type { PixelWindow } from '../geometry';

const SERVICE = 'https://example.org/arcgis/rest/services/NAIP/USDA_CONUS_PRIME/ImageServer';

// A 51x51 pixel window ten meters to a pixel, clicked in the middle
const WINDOW: PixelWindow = { bbox: '-10000,0,-9490,510', width: 51, height: 51, x: 25, y: 25 };

// Reads a hand-built service description instead of fetching one
class TestResource extends EsriImageMapLayerResource {
  stub: EsriMetadata = {};

  protected async getMetadata() {
    return this.stub;
  }
}

const resourceFor = (stub: EsriMetadata = {}) => {
  const resource = new TestResource('naip', SERVICE, undefined);
  resource.stub = stub;
  return resource;
};

// Answer one identify request with the given body
const stubIdentify = (body: unknown) => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

describe('EsriImageMapLayerResource#getMapLibreSourceUrl', () => {
  it('renders through the exportImage endpoint an ImageServer uses', () => {
    const url = resourceFor().getMapLibreSourceUrl();

    expect(url).toContain(`${SERVICE}/exportImage?`);
    expect(url).toContain('&bbox={bbox-epsg-3857}');
  });

  it('has no layers to choose between', () => {
    expect(new URL(resourceFor().getMapLibreSourceUrl()).searchParams.get('layers')).toBeNull();
  });
});

describe('EsriImageMapLayerResource#canInspect', () => {
  it('is true for any ImageServer that can draw an image', async () => {
    expect(await resourceFor({ capabilities: 'Catalog,Mensuration,Image,Metadata' }).canInspect()).toBe(true);
  });

  it('is false for a service that publishes no imagery', async () => {
    expect(await resourceFor({ capabilities: 'Metadata' }).canInspect()).toBe(false);
  });
});

describe('EsriImageMapLayerResource#inspect', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reports the pixel under the click as a point feature', async () => {
    stubIdentify({ name: 'Pixel', value: '359.053', properties: null });

    const features = await resourceFor().inspect(WINDOW);

    expect(features).toHaveLength(1);
    expect(features[0].properties).toEqual({ Pixel: '359.053' });
    expect(features[0].geometry).toEqual({ type: 'Point', coordinates: [-9745, 255] });
  });

  it('asks about the coordinate at the middle of the clicked pixel', async () => {
    const fetchMock = stubIdentify({ name: 'Pixel', value: 1 });
    await resourceFor().inspect(WINDOW);

    const params = new URL(fetchMock.mock.calls[0][0]).searchParams;
    expect(JSON.parse(params.get('geometry') as string)).toEqual({ x: -9745, y: 255, spatialReference: { wkid: 3857 } });
    expect(params.get('geometryType')).toEqual('esriGeometryPoint');
  });

  it('does not ask for the geometry or the mosaic behind the pixel', async () => {
    const fetchMock = stubIdentify({ name: 'Pixel', value: 1 });
    await resourceFor().inspect(WINDOW);

    const params = new URL(fetchMock.mock.calls[0][0]).searchParams;
    expect(params.get('returnGeometry')).toEqual('false');
    expect(params.get('returnCatalogItems')).toEqual('false');
  });

  it('includes any extra properties the service reports alongside the value', async () => {
    stubIdentify({ name: 'Pixel', value: '12', properties: { Dataset: 'NAIP 2022' } });

    expect((await resourceFor().inspect(WINDOW))[0].properties).toEqual({ Pixel: '12', Dataset: 'NAIP 2022' });
  });

  it('has no features where the service has no coverage', async () => {
    for (const value of ['NoData', '', null, undefined]) {
      stubIdentify({ name: 'Pixel', value });
      expect(await resourceFor().inspect(WINDOW)).toEqual([]);
    }
  });

  it('reports a pixel whose value is zero, which is data like any other', async () => {
    stubIdentify({ name: 'Pixel', value: 0 });
    expect(await resourceFor().inspect(WINDOW)).toHaveLength(1);
  });
});
