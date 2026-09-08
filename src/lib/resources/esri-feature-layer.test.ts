import { describe, it, expect, vi, afterEach } from '@stencil/vitest';
import { LngLatBounds } from 'maplibre-gl';

import EsriFeatureLayerResource from './esri-feature-layer';
import type { EsriExtent, EsriMetadata } from '../esri';

const LAYER = 'https://example.org/arcgis/rest/services/Landscape_Trees/FeatureServer/0';

const QUERYABLE: EsriMetadata = {
  name: 'Landscape_Trees',
  extent: { xmin: -82.45, ymin: 35.6, xmax: -82.43, ymax: 35.62, spatialReference: { wkid: 4326 } },
  maxRecordCount: 2,
  objectIdFieldName: 'FID',
  supportedQueryFormats: 'JSON, geoJSON, PBF',
  advancedQueryCapabilities: { supportsPagination: true },
};

// Reads a hand-built layer description and size instead of fetching either, so what a test queues
// a response for is the read itself. A size of undefined lets the real probe run.
class TestResource extends EsriFeatureLayerResource {
  stub: EsriMetadata = {};
  size: { count?: number; extent?: EsriExtent } | undefined = { count: 1_000_000 };

  protected async getMetadata() {
    return this.stub;
  }

  protected async getQuerySummary() {
    return this.size ?? (await super.getQuerySummary());
  }

  // Reached through the fields a query asks for everywhere else; named here for the one test that
  // is about the choice rather than the request
  async outFields() {
    return await this.getOutFields();
  }
}

const resourceFor = (stub: EsriMetadata = QUERYABLE, bounds?: LngLatBounds, size: { count?: number; extent?: EsriExtent } | undefined = { count: 1_000_000 }) => {
  const resource = new TestResource('trees', LAYER, bounds);
  resource.stub = stub;
  resource.size = size;
  return resource;
};

// One that really asks the service how big the layer is, rather than being told. A separate helper
// because passing undefined for `size` above would take the default instead.
const probingResourceFor = (stub: EsriMetadata = QUERYABLE) => {
  const resource = resourceFor(stub);
  resource.size = undefined;
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

  it('asks for the geometry, and degrees rather than the layer own projection', async () => {
    const fetchMock = stubPages({ type: 'FeatureCollection', features: [tree(1)] });
    await resourceFor().getData();

    const params = new URL(fetchMock.mock.calls[0][0]).searchParams;
    expect(params.get('where')).toEqual('1=1');
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

describe('EsriFeatureLayerResource fields', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads a layer small enough to hold with every field it has', async () => {
    const fetchMock = stubPages({ type: 'FeatureCollection', features: [tree(1)] });
    await resourceFor(QUERYABLE, undefined, { count: 348 }).getData();

    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('outFields')).toEqual('*');
  });

  it('reads a layer too large to hold with only the field that identifies a feature', async () => {
    // The attributes are the payload on a layer this size: 1,749 bytes a feature against 138 for a
    // geometry and an ObjectID. A click fetches the rest - see getAttributes.
    const fetchMock = stubPages({ type: 'FeatureCollection', features: [tree(1)] });
    await resourceFor(QUERYABLE, undefined, { count: 318_295 }).getData();

    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('outFields')).toEqual('FID');
  });

  it('reads a layer that will not say how big it is slim, rather than in full', async () => {
    const fetchMock = stubPages({ type: 'FeatureCollection', features: [tree(1)] });
    await resourceFor(QUERYABLE, undefined, {}).getData();

    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('outFields')).toEqual('FID');
  });

  it('asks as well for the fields the style layers draw with, where the layer has them', async () => {
    const stub = { ...QUERYABLE, fields: [{ name: 'FID', type: 'esriFieldTypeOID' }, { name: 'label' }, { name: 'available' }, { name: 'Spp_Code' }] };

    expect(await resourceFor(stub).outFields()).toEqual('FID,label,available');
  });

  it('asks for no style field the layer does not have, which a service would reject the query for', async () => {
    expect(await resourceFor({ ...QUERYABLE, fields: [{ name: 'FID', type: 'esriFieldTypeOID' }] }).outFields()).toEqual('FID');
  });

  it('says whether a click still has anything to ask the service for', async () => {
    expect(await resourceFor(QUERYABLE, undefined, { count: 348 }).readsAllFields()).toEqual(true);
    expect(await resourceFor(QUERYABLE, undefined, { count: 318_295 }).readsAllFields()).toEqual(false);
  });
});

describe('EsriFeatureLayerResource#getPaging', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks for a standard page where the service will answer with one, and says so', async () => {
    // 16,000 rather than 2,000 is the difference between one round trip and eight
    const stub = { ...QUERYABLE, standardMaxRecordCount: 16000, advancedQueryCapabilities: { supportsPagination: true, supportsQueryWithResultType: true } };
    const fetchMock = stubPages({ type: 'FeatureCollection', features: [tree(1)] });
    await resourceFor(stub).getData();

    const params = new URL(fetchMock.mock.calls[0][0]).searchParams;
    expect(params.get('resultType')).toEqual('standard');

    // Never more than the read is going to keep: a bigger page is bytes spent on features that get
    // sliced off again
    expect(params.get('resultRecordCount')).toEqual('10000');
  });

  it('leaves the result type off for a service that has not said it understands one', async () => {
    const stub = { ...QUERYABLE, standardMaxRecordCount: 16000, advancedQueryCapabilities: { supportsQueryWithResultType: false } };
    const fetchMock = stubPages({ type: 'FeatureCollection', features: [tree(1)] });
    await resourceFor(stub).getData();

    const params = new URL(fetchMock.mock.calls[0][0]).searchParams;
    expect(params.get('resultType')).toBeNull();
    expect(params.get('resultRecordCount')).toEqual('2');
  });
});

describe('EsriFeatureLayerResource#getQuerySummary', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks how much there is and where it is in one request, in degrees', async () => {
    const fetchMock = stubPages(
      { count: 318295, extent: { xmin: -92.9, ymin: 42.4, xmax: -86.7, ymax: 47.1, spatialReference: { wkid: 4326 } } },
      {
        type: 'FeatureCollection',
        features: [tree(1)],
      },
    );

    await probingResourceFor().getData();

    const params = new URL(fetchMock.mock.calls[0][0]).searchParams;
    expect(params.get('returnCountOnly')).toEqual('true');
    expect(params.get('returnExtentOnly')).toEqual('true');
    expect(params.get('outSR')).toEqual('4326');
  });

  it('asks once however many times it is read', async () => {
    const fetchMock = stubPages({ count: 318295 }, { type: 'FeatureCollection', features: [tree(1)] });
    const resource = probingResourceFor();

    await resource.getData();
    await resource.readsAllFields();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reads a layer it could not measure at all, rather than failing the preview', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Server Error' });
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ type: 'FeatureCollection', features: [tree(1)] }) });
    vi.stubGlobal('fetch', fetchMock);

    expect((await probingResourceFor().getData()).features).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Could not measure'), expect.anything());

    warn.mockRestore();
  });
});

describe('EsriFeatureLayerResource#getAttributes', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks the service about the features by id, for every field and no geometry', async () => {
    const fetchMock = stubPages({ objectIdFieldName: 'FID', features: [{ attributes: { FID: 9, Spp_Code: 'ACRU' } }] });
    const attributes = await resourceFor().getAttributes([9, 12]);

    const params = new URL(fetchMock.mock.calls[0][0]).searchParams;
    expect(params.get('objectIds')).toEqual('9,12');
    expect(params.get('outFields')).toEqual('*');
    expect(params.get('returnGeometry')).toEqual('false');
    expect(attributes.get(9)).toEqual({ FID: 9, Spp_Code: 'ACRU' });
  });

  it('asks nothing about no features', async () => {
    const fetchMock = stubPages();

    expect((await resourceFor().getAttributes([])).size).toEqual(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('EsriFeatureLayerResource#tilesFeatures', () => {
  it('reads a layer small enough to hold whole', async () => {
    expect(await resourceFor(QUERYABLE, undefined, { count: 348 }).tilesFeatures()).toEqual(false);
  });

  it('tiles a layer too large to hold', async () => {
    expect(await resourceFor(QUERYABLE, undefined, { count: 318_295 }).tilesFeatures()).toEqual(true);
  });

  it('tiles a layer that will not say how big it is', async () => {
    // An empty tile and a warning is a better failure than a stalled browser, and a layer whose
    // size is a surprise is the one to be careful with
    expect(await resourceFor(QUERYABLE, undefined, {}).tilesFeatures()).toEqual(true);
  });
});

describe('EsriFeatureLayerResource#fetchTile', () => {
  afterEach(() => vi.unstubAllGlobals());

  const POINTS = { ...QUERYABLE, geometryType: 'esriGeometryPoint', tileMaxRecordCount: 8000, advancedQueryCapabilities: { supportsQueryWithResultType: true } };

  // Inside tile 10/257/375, which is the one over Madison. A feature anywhere else is clipped out
  // of it - see encodeFeatureTile - so a tile test has to answer with something that belongs there.
  const inMadison = { type: 'Feature', id: 1, geometry: { type: 'Point', coordinates: [-89.4, 43.07] }, properties: { FID: 1 } };

  it('asks only about the tile box, in the grid MapLibre draws in', async () => {
    const fetchMock = stubPages({ type: 'FeatureCollection', features: [tree(1)] });
    await resourceFor(POINTS).fetchTile(10, 257, 375);

    const params = new URL(fetchMock.mock.calls[0][0]).searchParams;
    expect(params.get('geometryType')).toEqual('esriGeometryEnvelope');
    expect(params.get('inSR')).toEqual('3857');
    expect(params.get('outSR')).toEqual('4326');
    expect(params.get('spatialRel')).toEqual('esriSpatialRelIntersects');

    // The tile's own box, widened by the buffer the tiler keeps features in
    const box = (params.get('geometry') as string).split(',').map(Number).map(Math.round);
    expect(box).toEqual([-9980230, 5321852, -9939871, 5362210]);
  });

  it('asks for a tile worth of features, which is more than a plain query would answer with', async () => {
    const fetchMock = stubPages({ type: 'FeatureCollection', features: [tree(1)] });
    await resourceFor(POINTS).fetchTile(10, 257, 375);

    const params = new URL(fetchMock.mock.calls[0][0]).searchParams;
    expect(params.get('resultType')).toEqual('tile');
    expect(params.get('resultRecordCount')).toEqual('8000');
  });

  it('sends the record count factor to a service that has not said it understands a result type', async () => {
    const stub = { ...POINTS, maxRecordCountFactor: 4, advancedQueryCapabilities: { supportsQueryWithResultType: false, supportsMaxRecordCountFactor: true } };
    const fetchMock = stubPages({ type: 'FeatureCollection', features: [tree(1)] });
    await resourceFor(stub).fetchTile(10, 257, 375);

    const params = new URL(fetchMock.mock.calls[0][0]).searchParams;
    expect(params.get('resultType')).toBeNull();
    expect(params.get('maxRecordCountFactor')).toEqual('4');
  });

  it('asks a polygon layer to generalize to what a tile can draw, and a point layer not to', async () => {
    // An ungeneralized county boundary is most of a tile; a point has no detail to throw away
    const shapes = stubPages({ type: 'FeatureCollection', features: [tree(1)] });
    await resourceFor({ ...POINTS, geometryType: 'esriGeometryPolygon' }).fetchTile(10, 257, 375);
    expect(new URL(shapes.mock.calls[0][0]).searchParams.get('maxAllowableOffset')).toEqual(String(360 / 2 ** 10 / 4096));

    vi.unstubAllGlobals();
    const points = stubPages({ type: 'FeatureCollection', features: [tree(1)] });
    await resourceFor(POINTS).fetchTile(10, 257, 375);
    expect(new URL(points.mock.calls[0][0]).searchParams.get('maxAllowableOffset')).toBeNull();
  });

  it('answers with a vector tile of what the service returned', async () => {
    stubPages({ type: 'FeatureCollection', features: [inMadison] });
    const data = await resourceFor(POINTS).fetchTile(10, 257, 375);

    expect(data).toBeInstanceOf(ArrayBuffer);
    expect((data as ArrayBuffer).byteLength).toBeGreaterThan(0);
  });

  it('has no tile for features the service answered with from outside the box', async () => {
    // Nothing here belongs in a tile over Madison, so nothing is drawn into one
    stubPages({ type: 'FeatureCollection', features: [tree(1)] });

    expect(await resourceFor(POINTS).fetchTile(10, 257, 375)).toBeUndefined();
  });

  it('has no tile for a box the service found nothing in', async () => {
    stubPages({ type: 'FeatureCollection', features: [] });

    expect(await resourceFor(POINTS).fetchTile(10, 257, 375)).toBeUndefined();
  });

  it('fails loudly while nothing has drawn, so an empty map is explained', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Server Error' });
    vi.stubGlobal('fetch', fetchMock);

    await expect(resourceFor(POINTS).fetchTile(10, 257, 375)).rejects.toThrow();
  });

  it('gives up quietly on a tile that failed after something already drew', async () => {
    // A tiled layer makes tens of these; one that went wrong under a preview a reader is already
    // looking at is worth a line in the console, not an alert over the whole thing
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ type: 'FeatureCollection', features: [inMadison] }) });
    fetchMock.mockResolvedValue({ ok: false, status: 500, statusText: 'Server Error' });
    vi.stubGlobal('fetch', fetchMock);

    const resource = resourceFor(POINTS);
    await resource.fetchTile(10, 257, 375);

    expect(await resource.fetchTile(10, 258, 375)).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Could not read a tile'), expect.anything());

    warn.mockRestore();
  });

  it('lets an abandoned tile stay abandoned, whatever else has drawn', async () => {
    const fetchMock = vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(resourceFor(POINTS).fetchTile(10, 257, 375)).rejects.toThrow('aborted');
  });

  it('records the zoom a tile came back short at, so the view can say what is missing and when', async () => {
    stubPages({ type: 'FeatureCollection', features: [inMadison], properties: { exceededTransferLimit: true } });
    const resource = resourceFor(POINTS);
    await resource.fetchTile(10, 257, 375);

    expect(resource.cappedAtZoom).toEqual(10);

    // Not the whole-layer read's own flag: that one means a paged read stopped at MAX_FEATURES,
    // which a tiled layer never does
    expect(resource.truncated).toEqual(false);
  });

  it('keeps the deepest zoom it was cut short at, not the last one it tried', async () => {
    const fetchMock = vi.fn();
    const short = { type: 'FeatureCollection', features: [inMadison], properties: { exceededTransferLimit: true } };
    [short, short].forEach(page => fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => page }));
    vi.stubGlobal('fetch', fetchMock);

    const resource = resourceFor(POINTS);
    await resource.fetchTile(12, 1030, 1503);
    await resource.fetchTile(10, 257, 375);

    // Zooming back out after a deeper tile was cut short doesn't make the shallower one the answer
    expect(resource.cappedAtZoom).toEqual(12);
  });

  it('has no capped zoom for a layer the service answers in full', async () => {
    stubPages({ type: 'FeatureCollection', features: [inMadison] });
    const resource = resourceFor(POINTS);
    await resource.fetchTile(10, 257, 375);

    expect(resource.cappedAtZoom).toBeUndefined();
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

  it('takes the extent the query reports when the layer own cannot be converted', async () => {
    // A layer stored in a state plane grid reports its extent in that grid, which we have no
    // projection library to convert; the query answers in degrees whatever the layer is stored in
    const stub = { ...QUERYABLE, extent: { xmin: 189000, ymin: 4800000, xmax: 761000, ymax: 5472000, spatialReference: { wkid: 26915 } } };
    const size = { count: 318_295, extent: { xmin: -92.9, ymin: 42.4, xmax: -86.7, ymax: 47.1, spatialReference: { wkid: 4326 } } };
    const bounds = (await resourceFor(stub, undefined, size).getBounds()) as LngLatBounds;

    expect(bounds.getWest()).toEqual(-92.9);
    expect(bounds.getNorth()).toEqual(47.1);
  });

  it('measures the features of a layer small enough to have read them', async () => {
    const stub = { ...QUERYABLE, extent: { xmin: 189000, ymin: 4800000, xmax: 761000, ymax: 5472000, spatialReference: { wkid: 26915 } } };
    stubPages({ type: 'FeatureCollection', features: [tree(1)] });

    expect(await resourceFor(stub, undefined, { count: 348 }).getBounds()).toEqual([
      [-82.44, 35.61],
      [-82.44, 35.61],
    ]);
  });

  it('never reads a tiled layer to answer where to point the camera', async () => {
    // The whole read is what tiling exists to avoid; a camera question is no reason to make it
    const stub = { ...QUERYABLE, extent: undefined };
    const fetchMock = stubPages();

    expect(await resourceFor(stub, undefined, { count: 318_295 }).getBounds()).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('has no bounds when there is nothing to measure', async () => {
    const stub = { ...QUERYABLE, extent: undefined };
    stubPages({ type: 'FeatureCollection', features: [] });

    expect(await resourceFor(stub, undefined, { count: 0 }).getBounds()).toBeUndefined();
  });
});

describe('EsriFeatureLayerResource#getVectorLayers', () => {
  it('names its layer apart from plain GeoJSON, which a record can also carry', async () => {
    expect(await resourceFor().getVectorLayers()).toEqual(['esri']);
  });
});
