import { describe, it, expect, vi, afterEach } from '@stencil/vitest';
import { SourceView } from '@chunkd/source';
import { GeoTIFF } from '@developmentseed/geotiff';

import { openGeoTIFF, TransformedGeoTIFFSource } from './geotiff';
import type { RequestTransform } from './request';

const COG_URL = 'https://stacks.stanford.edu/file/druid:bb021mm7809/scan.tif';

// A restricted COG at Stanford is reached with cookies rather than a token, which is the case
// SourceHttp cannot serve: its fetch is one static shared by every source on the page.
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

  // cogeotiff reads a COG's footer by asking for everything from an offset, with no length
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

    // A COG is one file read over many requests, so its header reads are metadata and its byte ranges
    // are the image itself. A transform gets told which, the same as everywhere else.
    it('asks about a header read and a data read separately', async () => {
      respondWith();
      const transform = vi.fn().mockReturnValue(undefined);
      const source = new TransformedGeoTIFFSource(COG_URL, transform);

      await source.head();
      await source.fetch(0, 16);

      expect(transform.mock.calls.map(([, resourceType]) => resourceType)).toEqual(['metadata', 'tile']);
    });

    // Read fresh every time rather than once in the constructor, so a token renewed mid-read is used
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

    // The trap this class exists to avoid: on a range response content-length is the length of the
    // chunk, not of the file, and recording it as the size gets every later read refused as past the
    // end of the file. Browsers can't read content-range unless the server exposes it, and S3 doesn't.
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

    // Verified against stanford-bb021mm7809: read without a session, stacks redirects to the identity
    // provider, fetch follows, and the login form arrives as a 206 with the range honoured. Taken at
    // face value those bytes go to the TIFF parser and fail as a malformed header instead.
    it('refuses a login page dressed up as a range response', async () => {
      respondWith('<!DOCTYPE html><html lang="en">', { 'content-type': 'text/html;charset=utf-8' }, true, 206);
      const source = new TransformedGeoTIFFSource(COG_URL, withCookies);

      await expect(source.fetch(0, 1023)).rejects.toMatchObject({ code: 401 });
    });

    it('refuses one on a HEAD too', async () => {
      respondWith('<!DOCTYPE html>', { 'content-type': 'text/html;charset=utf-8' });
      const source = new TransformedGeoTIFFSource(COG_URL, withCookies);

      await expect(source.head()).rejects.toMatchObject({ code: 401 });
    });

    // A session can be established after the first attempt, so one refusal must not become the answer
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

    // Every tile read would otherwise be handed the file header and fail inside a codec, which is
    // where the error would appear to come from. Stencil's dev server does this, so it is what a COG
    // served by `npm start` does.
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

    // A range covering the whole of a small file is allowed to come back as a 200, so the body is what
    // decides rather than the status: this one is no longer than what was asked for.
    it('accepts a 200 no longer than the range it asked for', async () => {
      respondWith(new ArrayBuffer(300), {}, true, 200);
      const source = new TransformedGeoTIFFSource(COG_URL);

      await expect(source.fetch(0, 512)).resolves.toHaveProperty('byteLength', 300);
    });

    // The file was replaced between reads, so the bytes already held describe a different image
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

  // GeoTIFF.fromUrl builds exactly this, over a source that can't be given cookies. Getting the
  // layering wrong wouldn't fail outright, it would just read the header in far more requests.
  it('layers chunking and caching over the source, the way fromUrl does', async () => {
    const open = vi.spyOn(GeoTIFF, 'open').mockResolvedValue({} as GeoTIFF);

    await openGeoTIFF(COG_URL, withCookies);

    const { dataSource, headerSource } = open.mock.calls[0][0];
    expect(dataSource).toBeInstanceOf(TransformedGeoTIFFSource);
    expect(headerSource).toBeInstanceOf(SourceView);
    expect((headerSource as SourceView).middleware.map(({ name }) => name)).toEqual(['source:chunk', 'source:cache']);
  });

  // Tile data is read once and handed to the decoder, so putting it through the header cache would
  // only copy it - the raw source is what fromUrl hands over too
  it('reads tile data past the header cache, over the same source', async () => {
    const open = vi.spyOn(GeoTIFF, 'open').mockResolvedValue({} as GeoTIFF);

    await openGeoTIFF(COG_URL);

    const { dataSource, headerSource } = open.mock.calls[0][0];
    expect((headerSource as SourceView).source).toBe(dataSource);
  });
});
