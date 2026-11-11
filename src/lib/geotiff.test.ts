import { describe, it, expect, vi, afterEach } from '@stencil/vitest';
import { DEFAULT_CONCURRENCY_LIMITER } from '@developmentseed/deck.gl-geotiff';
import { GeoTIFF } from '@developmentseed/geotiff';
import { fileIdentity, RangeReader } from '@developmentseed/range-reader';

import { ChallengeError, HttpError, SignInError, referenceError } from './errors';
import { openGeoTIFF, transformedFetch } from './geotiff';
import type { RequestTransform } from './request';

const COG_URL = 'https://stacks.stanford.edu/file/druid:bb021mm7809/scan.tif';

const withCookies: RequestTransform = url => (url.startsWith('https://stacks.stanford.edu/') ? { credentials: 'include' } : undefined);

const respondWith = (body: BodyInit | null = new Uint8Array(8), init: ResponseInit = { status: 206 }) =>
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(body, init));

const lastRequest = (fetchSpy: ReturnType<typeof respondWith>) => {
  const [url, init] = fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1] as [string, RequestInit];
  return { url, init, headers: new Headers(init.headers) };
};

const rangeRead = (fetcher: typeof fetch, range = 'bytes=0-15') => fetcher(COG_URL, { headers: { Range: range } });

describe('transformedFetch', () => {
  afterEach(() => vi.restoreAllMocks());

  it('passes the range the reader asks for through to the file', async () => {
    const fetchSpy = respondWith();

    await rangeRead(transformedFetch(), 'bytes=1024-1043');

    expect(lastRequest(fetchSpy).url).toEqual(COG_URL);
    expect(lastRequest(fetchSpy).headers.get('range')).toEqual('bytes=1024-1043');
  });

  describe('applying the request transform', () => {
    it('opts a restricted COG into cookies', async () => {
      const fetchSpy = respondWith();

      await rangeRead(transformedFetch(withCookies));

      expect(lastRequest(fetchSpy).init.credentials).toEqual('include');
    });

    it('carries a token without dropping the range it is reading', async () => {
      const fetchSpy = respondWith();

      await rangeRead(transformedFetch(() => ({ headers: { Authorization: 'Bearer t' } })));

      const { headers } = lastRequest(fetchSpy);
      expect([headers.get('range'), headers.get('authorization')]).toEqual(['bytes=0-15', 'Bearer t']);
    });

    it('honours a rewritten URL', async () => {
      const fetchSpy = respondWith();

      await rangeRead(transformedFetch(() => ({ url: 'https://example.com/signed.tif' })));

      expect(lastRequest(fetchSpy).url).toEqual('https://example.com/signed.tif');
    });

    it('asks again on every request, about the original URL, as a tile read', async () => {
      respondWith();
      const transform = vi.fn().mockReturnValue({ url: 'https://example.com/signed.tif' });
      const fetcher = transformedFetch(transform);

      await rangeRead(fetcher);
      await rangeRead(fetcher, 'bytes=16-31');

      expect(transform.mock.calls).toEqual([
        [COG_URL, 'tile'],
        [COG_URL, 'tile'],
      ]);
    });
  });

  describe('failures', () => {
    it('reports the status a refused read came back with', async () => {
      respondWith(null, { status: 403, statusText: 'Forbidden' });

      const error = await rangeRead(transformedFetch()).catch(e => e);
      expect(error).toBeInstanceOf(HttpError);
      expect(error).toMatchObject({ status: 403, url: COG_URL });
    });

    it('reports a missing file as one, where the reader would read nothing', async () => {
      respondWith(null, { status: 404, statusText: 'Not Found' });

      await expect(rangeRead(transformedFetch())).rejects.toMatchObject({ status: 404 });
    });

    it('refuses a login page dressed up as a range response', async () => {
      respondWith('<!DOCTYPE html><html lang="en">', { status: 206, headers: { 'content-type': 'text/html;charset=utf-8' } });

      await expect(rangeRead(transformedFetch(withCookies))).rejects.toBeInstanceOf(SignInError);
    });

    it("tells a bot check from a login page, though it's HTML too", async () => {
      respondWith('', { status: 202, headers: { 'content-type': 'text/html; charset=UTF-8', 'x-amzn-waf-action': 'challenge' } });

      await expect(rangeRead(transformedFetch())).rejects.toBeInstanceOf(ChallengeError);
    });

    it('refuses a whole file handed back for a range read, and says whose fault it is', async () => {
      respondWith(new Uint8Array(16), { status: 200, headers: { 'content-length': String(2 * 1024 * 1024) } });

      await expect(rangeRead(transformedFetch())).rejects.toThrow('does not support range requests');
    });

    it('refuses one of unknown length too', async () => {
      respondWith(new Uint8Array(16), { status: 200 });

      await expect(rangeRead(transformedFetch())).rejects.toThrow('does not support range requests');
    });

    it('lets the reader keep a whole file small enough for one request', async () => {
      respondWith(new Uint8Array(300), { status: 200, headers: { 'content-length': '300' } });

      await expect(rangeRead(transformedFetch())).resolves.toHaveProperty('status', 200);
    });

    it('accepts a range that was actually served', async () => {
      respondWith(new Uint8Array(16), { status: 206, headers: { 'content-range': 'bytes 0-15/9876543' } });

      await expect(rangeRead(transformedFetch())).resolves.toHaveProperty('status', 206);
    });
  });
});

describe('reading through a range reader', () => {
  afterEach(() => vi.restoreAllMocks());

  const fileUrl = (name: string) => new URL(`https://example.com/${name}.tif`);

  it('merges neighbouring reads into one request', async () => {
    const fetchSpy = respondWith(new Uint8Array(32), { status: 206, headers: { 'content-range': 'bytes 0-31/1000' } });
    const reader = new RangeReader({ fetch: transformedFetch(withCookies) });
    const file = fileIdentity(fileUrl('merged'));

    await Promise.all([reader.read(file, { offset: 0, length: 16 }, {}), reader.read(file, { offset: 16, length: 16 }, {})]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(lastRequest(fetchSpy).headers.get('range')).toEqual('bytes=0-31');
  });

  it('rejects the read with our error, status and all', async () => {
    respondWith(null, { status: 403, statusText: 'Forbidden' });
    const reader = new RangeReader({ fetch: transformedFetch() });

    const error = await reader.read(fileIdentity(fileUrl('refused')), { offset: 0, length: 16 }, {}).catch(e => e);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ status: 403 });
  });
});

describe('openGeoTIFF', () => {
  afterEach(() => vi.restoreAllMocks());

  const readerOf = (fromUrl: ReturnType<typeof vi.spyOn>, call: number) => (fromUrl.mock.calls[call][1] as { reader: RangeReader }).reader;

  it('reads through the per-origin limiter deck.gl-geotiff shares', async () => {
    const fromUrl = vi.spyOn(GeoTIFF, 'fromUrl').mockResolvedValue({} as GeoTIFF);

    await openGeoTIFF(COG_URL, withCookies);

    const [url, options] = fromUrl.mock.calls[0];
    expect(url).toEqual(new URL(COG_URL));
    expect(options).toMatchObject({ concurrencyLimiter: DEFAULT_CONCURRENCY_LIMITER });
    expect(options?.reader).toBeInstanceOf(RangeReader);
  });

  it('keeps one reader per transform, so their cached bytes stay apart', async () => {
    const fromUrl = vi.spyOn(GeoTIFF, 'fromUrl').mockResolvedValue({} as GeoTIFF);
    const withToken: RequestTransform = () => ({ headers: { Authorization: 'Bearer t' } });

    await openGeoTIFF(COG_URL, withCookies);
    await openGeoTIFF(`${COG_URL}?2`, withCookies);
    await openGeoTIFF(COG_URL, withToken);
    await openGeoTIFF(COG_URL);
    await openGeoTIFF(`${COG_URL}?2`);

    expect(readerOf(fromUrl, 1)).toBe(readerOf(fromUrl, 0));
    expect(readerOf(fromUrl, 2)).not.toBe(readerOf(fromUrl, 0));
    expect(readerOf(fromUrl, 4)).toBe(readerOf(fromUrl, 3));
    expect(readerOf(fromUrl, 3)).not.toBe(readerOf(fromUrl, 0));
  });

  it('reports the status of a COG that refused to open', async () => {
    respondWith(null, { status: 403, statusText: 'Forbidden' });

    const error = await openGeoTIFF('https://example.com/refused.tif').catch(e => e);

    expect(referenceError(error, 'Cloud Optimized GeoTIFF').message).toContain('HTTP 403');
  });

  it('reports a bot check as one', async () => {
    respondWith('', { status: 202, headers: { 'content-type': 'text/html; charset=UTF-8', 'x-amzn-waf-action': 'challenge' } });

    const error = await openGeoTIFF('https://hgl.harvard.edu/data/public/G8962_B3_1800_A7.tif').catch(e => e);

    expect(referenceError(error, 'Cloud Optimized GeoTIFF').title).toBe('The Cloud Optimized GeoTIFF preview was blocked');
  });
});
