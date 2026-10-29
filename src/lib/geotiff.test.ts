import { describe, it, expect, vi, afterEach } from '@stencil/vitest';
import { SourceView } from '@chunkd/source';
import { GeoTIFF } from '@developmentseed/geotiff';

import { ChallengeError, referenceError } from './errors';
import { openGeoTIFF, TransformedGeoTIFFSource } from './geotiff';
import type { RequestTransform } from './request';

const COG_URL = 'https://stacks.stanford.edu/file/druid:bb021mm7809/scan.tif';

const withCookies: RequestTransform = url => (url.startsWith('https://stacks.stanford.edu/') ? { credentials: 'include' } : undefined);

const respondWith = (body: ArrayBuffer | string = new ArrayBuffer(8), headers: Record<string, string> = {}, ok = true, status = 200) =>
  vi.spyOn(global, 'fetch').mockResolvedValue({
    ok,
    status,
    statusText: ok ? 'OK' : 'Forbidden',
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    arrayBuffer: async () => (typeof body === 'string' ? new TextEncoder().encode(body).buffer : body),
  } as unknown as Response);

const lastRequest = (fetchSpy: ReturnType<typeof respondWith>) => {
  const [url, init] = fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1] as [string, RequestInit];
  return { url, init, headers: (init?.headers ?? {}) as Record<string, string> };
};

describe('TransformedGeoTIFFSource', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reads bytes with the range header @chunkd asks for', async () => {
    const fetchSpy = respondWith();
    const source = new TransformedGeoTIFFSource(COG_URL);

    await source.fetch(1024, 20);

    expect(lastRequest(fetchSpy).url).toEqual(COG_URL);
    expect(lastRequest(fetchSpy).headers.range).toEqual('bytes=1024-1043');
  });

  it('reads to the end of the file when given no length', async () => {
    const fetchSpy = respondWith();
    const source = new TransformedGeoTIFFSource(COG_URL);

    await source.fetch(4096);

    expect(lastRequest(fetchSpy).headers.range).toEqual('bytes=4096');
  });

  describe('applying the request transform', () => {
    it('opts a restricted COG into cookies, which is what SourceHttp cannot do', async () => {
      const fetchSpy = respondWith();
      const source = new TransformedGeoTIFFSource(COG_URL, withCookies);

      await source.fetch(0, 16);

      expect(lastRequest(fetchSpy).init.credentials).toEqual('include');
    });

    it('carries a token without dropping the range it is reading', async () => {
      const fetchSpy = respondWith();
      const source = new TransformedGeoTIFFSource(COG_URL, () => ({ headers: { Authorization: 'Bearer t' } }));

      await source.fetch(0, 16);

      expect(lastRequest(fetchSpy).headers).toEqual({ range: 'bytes=0-15', Authorization: 'Bearer t' });
    });

    it('honours a rewritten URL', async () => {
      const fetchSpy = respondWith();
      const source = new TransformedGeoTIFFSource(COG_URL, () => ({ url: 'https://example.com/signed.tif' }));

      await source.fetch(0, 16);

      expect(lastRequest(fetchSpy).url).toEqual('https://example.com/signed.tif');
    });

    it('asks about a header read and a data read separately', async () => {
      respondWith();
      const transform = vi.fn().mockReturnValue(undefined);
      const source = new TransformedGeoTIFFSource(COG_URL, transform);

      await source.head();
      await source.fetch(0, 16);

      expect(transform.mock.calls.map(([, resourceType]) => resourceType)).toEqual(['metadata', 'tile']);
    });

    it('asks again on every request', async () => {
      respondWith();
      const transform = vi.fn().mockReturnValue(undefined);
      const source = new TransformedGeoTIFFSource(COG_URL, transform);

      await source.fetch(0, 16);
      await source.fetch(16, 16);

      expect(transform).toHaveBeenCalledTimes(2);
    });
  });

  describe('recording the file size', () => {
    it('takes it from a HEAD, where content-length describes the whole file', async () => {
      respondWith(new ArrayBuffer(0), { 'content-length': '9876543' });
      const source = new TransformedGeoTIFFSource(COG_URL);

      expect(await source.head()).toMatchObject({ size: 9876543 });
      expect(source.metadata?.size).toEqual(9876543);
    });

    it("ignores content-length on a range response, where it is only the chunk's", async () => {
      respondWith(new ArrayBuffer(64), { 'content-length': '64' });
      const source = new TransformedGeoTIFFSource(COG_URL);

      await source.fetch(0, 64);

      expect(source.metadata?.size).toBeUndefined();
    });

    it('takes it from content-range where the server does expose it', async () => {
      respondWith(new ArrayBuffer(64), { 'content-length': '64', 'content-range': 'bytes 0-63/9876543' });
      const source = new TransformedGeoTIFFSource(COG_URL);

      await source.fetch(0, 64);

      expect(source.metadata?.size).toEqual(9876543);
    });
  });

  describe('failures', () => {
    it('reports the status a refused read came back with', async () => {
      respondWith(new ArrayBuffer(0), {}, false, 403);
      const source = new TransformedGeoTIFFSource(COG_URL);

      await expect(source.fetch(0, 16)).rejects.toMatchObject({ code: 403 });
    });

    it('refuses a login page dressed up as a range response', async () => {
      respondWith('<!DOCTYPE html><html lang="en">', { 'content-type': 'text/html;charset=utf-8' }, true, 206);
      const source = new TransformedGeoTIFFSource(COG_URL, withCookies);

      await expect(source.fetch(0, 1023)).rejects.toMatchObject({ code: 401 });
    });

    it("tells a bot check from a login page, though it's HTML too", async () => {
      respondWith('', { 'content-type': 'text/html; charset=UTF-8', 'x-amzn-waf-action': 'challenge' }, true, 202);
      const source = new TransformedGeoTIFFSource('https://hgl.harvard.edu/data/public/G8962_B3_1800_A7.tif');

      const error = await source.head().catch(e => e);
      expect(error).toMatchObject({ code: 403 });
      expect(error.cause).toBeInstanceOf(ChallengeError);
      expect(referenceError(error, 'Cloud Optimized GeoTIFF').title).toBe('The Cloud Optimized GeoTIFF preview was blocked');
    });

    it('refuses one on a HEAD too', async () => {
      respondWith('<!DOCTYPE html>', { 'content-type': 'text/html;charset=utf-8' });
      const source = new TransformedGeoTIFFSource(COG_URL, withCookies);

      await expect(source.head()).rejects.toMatchObject({ code: 401 });
    });

    it('lets a refused HEAD be asked again rather than caching the refusal', async () => {
      const fetchSpy = respondWith(new ArrayBuffer(0), {}, false, 403);
      const source = new TransformedGeoTIFFSource(COG_URL);

      await expect(source.head()).rejects.toMatchObject({ code: 403 });
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: (name: string) => (name.toLowerCase() === 'content-length' ? '1000' : null) },
        arrayBuffer: async () => new ArrayBuffer(0),
      } as unknown as Response);

      expect(await source.head()).toMatchObject({ size: 1000 });
    });

    it('answers a repeated HEAD from the first one', async () => {
      const fetchSpy = respondWith(new ArrayBuffer(0), { 'content-length': '1000' });
      const source = new TransformedGeoTIFFSource(COG_URL);

      await source.head();
      await source.head();

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('refuses a whole file handed back for a range read, and says whose fault it is', async () => {
      respondWith(new ArrayBuffer(4096), {}, true, 200);
      const source = new TransformedGeoTIFFSource(COG_URL);

      await expect(source.fetch(0, 512)).rejects.toThrow('does not support range requests');
    });

    it('accepts a range that was actually served', async () => {
      respondWith(new ArrayBuffer(512), {}, true, 206);
      const source = new TransformedGeoTIFFSource(COG_URL);

      await expect(source.fetch(0, 512)).resolves.toHaveProperty('byteLength', 512);
    });

    it('accepts a 200 no longer than the range it asked for', async () => {
      respondWith(new ArrayBuffer(300), {}, true, 200);
      const source = new TransformedGeoTIFFSource(COG_URL);

      await expect(source.fetch(0, 512)).resolves.toHaveProperty('byteLength', 300);
    });

    it('refuses to mix reads of a file that changed underneath it', async () => {
      const fetchSpy = respondWith(new ArrayBuffer(64), { etag: '"first"' });
      const source = new TransformedGeoTIFFSource(COG_URL);
      await source.fetch(0, 64);

      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: (name: string) => (name.toLowerCase() === 'etag' ? '"second"' : null) },
        arrayBuffer: async () => new ArrayBuffer(64),
      } as unknown as Response);

      await expect(source.fetch(64, 64)).rejects.toMatchObject({ code: 409 });
    });
  });
});

describe('openGeoTIFF', () => {
  afterEach(() => vi.restoreAllMocks());

  it('layers chunking and caching over the source, the way fromUrl does', async () => {
    const open = vi.spyOn(GeoTIFF, 'open').mockResolvedValue({} as GeoTIFF);

    await openGeoTIFF(COG_URL, withCookies);

    const { dataSource, headerSource } = open.mock.calls[0][0];
    expect(dataSource).toBeInstanceOf(TransformedGeoTIFFSource);
    expect(headerSource).toBeInstanceOf(SourceView);
    expect((headerSource as SourceView).middleware.map(({ name }) => name)).toEqual(['source:chunk', 'source:cache']);
  });

  it('reads tile data past the header cache, over the same source', async () => {
    const open = vi.spyOn(GeoTIFF, 'open').mockResolvedValue({} as GeoTIFF);

    await openGeoTIFF(COG_URL);

    const { dataSource, headerSource } = open.mock.calls[0][0];
    expect((headerSource as SourceView).source).toBe(dataSource);
  });
});
