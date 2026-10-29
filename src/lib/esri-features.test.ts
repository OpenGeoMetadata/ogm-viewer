import { describe, it, expect, vi, afterEach } from '@stencil/vitest';
import { VectorTile } from '@mapbox/vector-tile';
import Protobuf from 'pbf';
import {
  encodeFeatureTile,
  esriFeatureTile,
  ESRI_FEATURES_SCHEME,
  featureTileToken,
  featureTileUrl,
  parseFeatureTileUrl,
  registerFeatureTiler,
  TILE_EXTENT,
  unregisterFeatureTiler,
  type EsriFeatureTiler,
} from './esri-features';

const tree = (id: number, lng = -89.4, lat = 43.07): GeoJSON.Feature => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lng, lat] },
  properties: { OBJECTID: id, photo_year_label: '1937' },
});

const Z = 10;
const X = 257;
const Y = 375;

const decode = (data: ArrayBuffer) => new VectorTile(new Protobuf(new Uint8Array(data)));

describe('featureTileUrl', () => {
  it('round trips a token and a tile coordinate', () => {
    const url = featureTileUrl('trees-esri-feature-layer-1').replace('{z}/{x}/{y}', '10/257/375');

    expect(url.startsWith(`${ESRI_FEATURES_SCHEME}://`)).toEqual(true);
    expect(parseFeatureTileUrl(url)).toEqual({ token: 'trees-esri-feature-layer-1', z: 10, x: 257, y: 375 });
  });

  it('keeps MapLibre own placeholders for MapLibre to fill', () => {
    expect(featureTileUrl('t')).toContain('/{z}/{x}/{y}');
  });

  it('survives a token out of a record id that needs escaping', () => {
    const token = 'urn:uuid:8609d43f/0b53 4813-esri-feature-layer-2';
    const url = featureTileUrl(token).replace('{z}/{x}/{y}', '1/2/3');

    expect(parseFeatureTileUrl(url)?.token).toEqual(token);
  });

  it('reads nothing out of a URL that is not one of ours', () => {
    expect(parseFeatureTileUrl('https://example.org/tiles/1/2/3')).toBeUndefined();
    expect(parseFeatureTileUrl('esri-features://token/not/a/tile')).toBeUndefined();
  });

  it('tells two copies of one source apart', () => {
    expect(featureTileToken('trees')).not.toEqual(featureTileToken('trees'));
  });
});

describe('encodeFeatureTile', () => {
  it('builds a vector tile of one layer, named the way the style layers read it', () => {
    const tile = decode(encodeFeatureTile([tree(1)], Z, X, Y, 'OBJECTID') as ArrayBuffer);

    expect(Object.keys(tile.layers)).toEqual(['esri']);
    expect(tile.layers.esri.length).toEqual(1);
    expect(tile.layers.esri.extent).toEqual(TILE_EXTENT);
  });

  it('keeps the service own ids, which is what a selection survives on', () => {
    const tile = decode(encodeFeatureTile([tree(4242)], Z, X, Y, 'OBJECTID') as ArrayBuffer);

    expect(tile.layers.esri.feature(0).id).toEqual(4242);
  });

  it('carries the properties the style layers draw with', () => {
    const tile = decode(encodeFeatureTile([tree(1)], Z, X, Y, 'OBJECTID') as ArrayBuffer);

    expect(tile.layers.esri.feature(0).properties.photo_year_label).toEqual('1937');
  });

  it('hands back its own bytes and nothing else', () => {
    const data = encodeFeatureTile([tree(1)], Z, X, Y, 'OBJECTID') as ArrayBuffer;
    const decoded = decode(data);

    expect(data.byteLength).toBeGreaterThan(0);
    expect(Object.keys(decoded.layers)).toEqual(['esri']);
  });

  it('has no tile for a box with nothing in it', () => {
    expect(encodeFeatureTile([], Z, X, Y, 'OBJECTID')).toBeUndefined();
  });

  it('drops what the query returned from outside the tile it was asked about', () => {
    const elsewhere = tree(2, -110, 40);

    expect(encodeFeatureTile([elsewhere], Z, X, Y, 'OBJECTID')).toBeUndefined();
  });
});

describe('the esri-features protocol', () => {
  afterEach(() => unregisterFeatureTiler('probe'));

  const request = async (url: string) => {
    const controller = new AbortController();
    return { response: await esriFeatureTile({ url }, controller), controller };
  };

  const transfer = (data: ArrayBuffer) => structuredClone(data, { transfer: [data] });

  const tilerFor = (overrides: Partial<EsriFeatureTiler> = {}): EsriFeatureTiler & { calls: number[][]; signals: (AbortSignal | undefined)[] } => {
    const tiler = {
      calls: [] as number[][],
      signals: [] as (AbortSignal | undefined)[],
      async fetchTile(z: number, x: number, y: number, signal?: AbortSignal) {
        tiler.calls.push([z, x, y]);
        tiler.signals.push(signal);
        return encodeFeatureTile([tree(1)], z, x, y, 'OBJECTID');
      },
      ...overrides,
    };
    return tiler;
  };

  it('asks the registered layer for the tile the URL names', async () => {
    const tiler = tilerFor();
    registerFeatureTiler('probe', tiler);

    const { response } = await request(`${ESRI_FEATURES_SCHEME}://probe/10/257/375`);

    expect(tiler.calls).toEqual([[10, 257, 375]]);
    expect(tiler.signals[0]).toBeInstanceOf(AbortSignal);
    expect(Object.keys(decode(response.data).layers)).toEqual(['esri']);
  });

  it('answers a tile nobody is registered for with an empty one, rather than a failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { response } = await request(`${ESRI_FEATURES_SCHEME}://gone/10/257/375`);

    expect(response.data.byteLength).toEqual(0);
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
  });

  it('reads a URL it cannot parse as an empty tile, rather than a failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { response } = await request('https://example.org/tiles/1/2/3');

    expect(response.data.byteLength).toEqual(0);
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
  });

  it('lets an abandoned tile stay abandoned', async () => {
    registerFeatureTiler('probe', {
      async fetchTile() {
        throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      },
    });

    await expect(request(`${ESRI_FEATURES_SCHEME}://probe/10/257/375`)).rejects.toThrow('aborted');
  });

  it('has an empty tile for a box the service found nothing in', async () => {
    registerFeatureTiler('probe', {
      async fetchTile() {
        return undefined;
      },
    });

    const { response } = await request(`${ESRI_FEATURES_SCHEME}://probe/10/257/375`);

    expect(response.data.byteLength).toEqual(0);
  });

  it('serves a cached tile again after MapLibre has taken the first one away', async () => {
    const tiler = tilerFor();
    registerFeatureTiler('probe', tiler);

    const first = await request(`${ESRI_FEATURES_SCHEME}://probe/10/257/375`);
    const size = first.response.data.byteLength;
    transfer(first.response.data);

    const second = await request(`${ESRI_FEATURES_SCHEME}://probe/10/257/375`);

    expect(tiler.calls).toHaveLength(1);
    expect(second.response.data.byteLength).toEqual(size);
    expect(Object.keys(decode(second.response.data).layers)).toEqual(['esri']);
  });

  it('has an empty tile left for the next one after MapLibre has taken one away', async () => {
    registerFeatureTiler('probe', {
      async fetchTile() {
        return undefined;
      },
    });

    const first = await request(`${ESRI_FEATURES_SCHEME}://probe/10/257/375`);
    transfer(first.response.data);

    const second = await request(`${ESRI_FEATURES_SCHEME}://probe/10/258/375`);

    expect(second.response.data.byteLength).toEqual(0);
    expect(() => second.response.data.slice(0)).not.toThrow();
  });
});
