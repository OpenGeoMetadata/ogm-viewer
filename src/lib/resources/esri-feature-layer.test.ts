import { describe, it, expect, vi, afterEach } from '@stencil/vitest';
import { LngLatBounds } from 'maplibre-gl';

import EsriFeatureLayerResource from './esri-feature-layer';
import type { EsriMetadata } from '../esri';

const LAYER = 'https://example.org/arcgis/rest/services/Landscape_Trees/FeatureServer/0';

const QUERYABLE: EsriMetadata = {
  name: 'Landscape_Trees',
  extent: { xmin: -82.45, ymin: 35.6, xmax: -82.43, ymax: 35.62, spatialReference: { wkid: 4326 } },
  maxRecordCount: 2,
  objectIdFieldName: 'FID',
  supportedQueryFormats: 'JSON, geoJSON, PBF',
  advancedQueryCapabilities: { supportsPagination: true },
};

// Reads a hand-built layer description instead of fetching one
class TestResource extends EsriFeatureLayerResource {
  stub: EsriMetadata = {};

  protected async getMetadata() {
    return this.stub;
  }
}

const resourceFor = (stub: EsriMetadata = QUERYABLE, bounds?: LngLatBounds) => {
  const resource = new TestResource('trees', LAYER, bounds);
  resource.stub = stub;
  return resource;
};

// A GeoJSON feature as a service answers with one
const tree = (id: number): GeoJSON.Feature => ({
  type: 'Feature',
  id,
  geometry: { type: 'Point', coordinates: [-82.44, 35.61] },
  properties: { FID: id, Spp_Code: 'ULPU' },
});

// Answer each query in turn with the given page bodies
const stubPages = (...pages: unknown[]) => {
  const fetchMock = vi.fn();
  pages.forEach(page => fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => page }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

describe('EsriFeatureLayerResource#getData', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads the features from the layer query endpoint', async () => {
    const fetchMock = stubPages({ type: 'FeatureCollection', features: [tree(1)] });
    const data = await resourceFor().getData();

    expect(fetchMock.mock.calls[0][0]).toContain(`${LAYER}/query?`);
    expect(data.type).toEqual('FeatureCollection');
    expect(data.features).toHaveLength(1);
  });

  it('asks for every field, the geometry, and degrees rather than the layer own projection', async () => {
    const fetchMock = stubPages({ type: 'FeatureCollection', features: [tree(1)] });
    await resourceFor().getData();

    const params = new URL(fetchMock.mock.calls[0][0]).searchParams;
    expect(params.get('where')).toEqual('1=1');
    expect(params.get('outFields')).toEqual('*');
    expect(params.get('returnGeometry')).toEqual('true');
    expect(params.get('outSR')).toEqual('4326');
    expect(params.get('f')).toEqual('geojson');
  });

  it('never asks for more per page than the service will answer with', async () => {
    const fetchMock = stubPages({ type: 'FeatureCollection', features: [tree(1)] });
    await resourceFor().getData();

    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('resultRecordCount')).toEqual('2');
  });

  it('keeps paging while the service says there is more, offsetting by what it has read', async () => {
    const fetchMock = stubPages(
      { type: 'FeatureCollection', features: [tree(1), tree(2)], exceededTransferLimit: true },
      { type: 'FeatureCollection', features: [tree(3), tree(4)], exceededTransferLimit: true },
      { type: 'FeatureCollection', features: [tree(5)] },
    );

    const data = await resourceFor().getData();

    expect(data.features).toHaveLength(5);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('resultOffset')).toEqual('0');
    expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get('resultOffset')).toEqual('2');
    expect(new URL(fetchMock.mock.calls[2][0]).searchParams.get('resultOffset')).toEqual('4');
  });

  it('reads the flag out of the properties, where newer services put it', async () => {
    const fetchMock = stubPages(
      { type: 'FeatureCollection', features: [tree(1), tree(2)], properties: { exceededTransferLimit: true } },
      { type: 'FeatureCollection', features: [tree(3)] },
    );

    expect((await resourceFor().getData()).features).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops after one page when the service cannot page at all', async () => {
    // Without paging the offset is ignored, so a second request would return the same features
    const stub = { ...QUERYABLE, advancedQueryCapabilities: { supportsPagination: false } };
    const fetchMock = stubPages({ type: 'FeatureCollection', features: [tree(1), tree(2)], exceededTransferLimit: true });

    expect((await resourceFor(stub).getData()).features).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops on an empty page even if the service still claims there is more', async () => {
    const fetchMock = stubPages(
      { type: 'FeatureCollection', features: [tree(1), tree(2)], exceededTransferLimit: true },
      { type: 'FeatureCollection', features: [], exceededTransferLimit: true },
    );

    expect((await resourceFor().getData()).features).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('converts Esri JSON when the service cannot answer in GeoJSON', async () => {
    const stub = { ...QUERYABLE, supportedQueryFormats: 'JSON' };
    const fetchMock = stubPages({
      objectIdFieldName: 'FID',
      features: [{ attributes: { FID: 9, Spp_Code: 'ACRU' }, geometry: { x: -82.44, y: 35.61 } }],
    });

    const data = await resourceFor(stub).getData();

    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('f')).toEqual('json');
    expect(data.features[0].id).toEqual(9);
    expect(data.features[0].geometry).toEqual({ type: 'Point', coordinates: [-82.44, 35.61] });
    expect(data.features[0].properties).toEqual({ FID: 9, Spp_Code: 'ACRU' });
  });

  it('reads the features only once', async () => {
    const fetchMock = stubPages({ type: 'FeatureCollection', features: [tree(1)] });
    const resource = resourceFor();

    const first = await resource.getData();
    expect(await resource.getData()).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('truncates a layer too large to draw, and says so', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const page = (count: number) => ({
      type: 'FeatureCollection',
      features: Array.from({ length: count }, (_unused, index) => tree(index)),
      exceededTransferLimit: true,
    });

    // Eleven pages of a thousand would be read if nothing stopped it at ten thousand
    const stub = { ...QUERYABLE, maxRecordCount: 1000 };
    const fetchMock = stubPages(...Array.from({ length: 11 }, () => page(1000)));

    expect((await resourceFor(stub).getData()).features).toHaveLength(10000);
    expect(fetchMock).toHaveBeenCalledTimes(10);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('only the first 10000'));

    warn.mockRestore();
  });
});

describe('EsriFeatureLayerResource#getBounds', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the extent the layer reports, without reading any features', async () => {
    const fetchMock = stubPages();
    const bounds = (await resourceFor().getBounds()) as LngLatBounds;

    expect(bounds.getWest()).toEqual(-82.45);
    expect(bounds.getNorth()).toEqual(35.62);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('prefers the bounds the record carried', async () => {
    const recordBounds = new LngLatBounds([-100, 30], [-90, 40]);
    expect(await resourceFor(QUERYABLE, recordBounds).getBounds()).toBe(recordBounds);
  });

  it('measures the features when the layer reports an extent we cannot convert', async () => {
    const stub = { ...QUERYABLE, extent: { xmin: 189000, ymin: 4800000, xmax: 761000, ymax: 5472000, spatialReference: { wkid: 26915 } } };
    stubPages({ type: 'FeatureCollection', features: [tree(1)] });

    expect(await resourceFor(stub).getBounds()).toEqual([
      [-82.44, 35.61],
      [-82.44, 35.61],
    ]);
  });

  it('has no bounds when there is nothing to measure', async () => {
    const stub = { ...QUERYABLE, extent: undefined };
    stubPages({ type: 'FeatureCollection', features: [] });

    expect(await resourceFor(stub).getBounds()).toBeUndefined();
  });
});

describe('EsriFeatureLayerResource#getVectorLayers', () => {
  it('names its layer apart from plain GeoJSON, which a record can also carry', async () => {
    expect(await resourceFor().getVectorLayers()).toEqual(['esri']);
  });
});
