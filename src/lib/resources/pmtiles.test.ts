import { describe, it, expect, vi, afterEach } from '@stencil/vitest';
import { EtagMismatch, Protocol } from 'pmtiles';

import PMTilesResource, { CheckedFetchSource } from './pmtiles';
import { ChallengeError, SignInError } from '../errors';
import type { RequestTransform } from '../request';

const URL = 'https://example.com/tiles.pmtiles';

const archiveOf = (resource: PMTilesResource) => (resource as any).archive;

describe('PMTilesResource', () => {
  afterEach(() => vi.restoreAllMocks());

  it('has no custom headers or credentials without a transform', () => {
    const source = archiveOf(new PMTilesResource('id', URL)).source;

    expect(source.getKey()).toEqual(URL);
    expect([...source.customHeaders.entries()]).toEqual([]);
    expect(source.credentials).toBeUndefined();
  });

  it('carries headers from a transform into the archive source', () => {
    const transform: RequestTransform = () => ({ headers: { Authorization: 'Bearer token' } });
    const source = archiveOf(new PMTilesResource('id', URL, undefined, transform)).source;

    expect(source.customHeaders.get('Authorization')).toEqual('Bearer token');
  });

  it('carries credentials from a transform into the archive source', () => {
    const transform: RequestTransform = () => ({ credentials: 'include' });
    const source = archiveOf(new PMTilesResource('id', URL, undefined, transform)).source;

    expect(source.credentials).toEqual('include');
  });

  it("drops 'omit' credentials rather than passing them to FetchSource, which doesn't accept them", () => {
    const transform: RequestTransform = () => ({ credentials: 'omit' });
    const source = archiveOf(new PMTilesResource('id', URL, undefined, transform)).source;

    expect(source.credentials).toBeUndefined();
  });

  it('asks the transform for a tile request, not a metadata one - the archive serves both from the same source', () => {
    const seen: string[] = [];
    const transform: RequestTransform = (_url, resourceType) => {
      seen.push(resourceType);
      return undefined;
    };

    new PMTilesResource('id', URL, undefined, transform);
    expect(seen).toEqual(['tile']);
  });

  it('keeps the plain resource url in the pmtiles:// source even when the transform rewrote it', () => {
    const transform: RequestTransform = () => ({ url: 'https://proxy.example.com/tiles.pmtiles', headers: { Authorization: 'Bearer token' } });
    const resource = new PMTilesResource('id', URL, undefined, transform);

    expect(resource.getMapLibreSourceUrl()).toEqual(`pmtiles://${URL}`);
    expect(archiveOf(resource).source.getKey()).toEqual(URL);
  });

  it('registers the archive with the shared protocol, so a tile request reuses it rather than opening a second, unauthenticated one', () => {
    const addSpy = vi.spyOn(Protocol.prototype, 'add');
    const resource = new PMTilesResource('id', URL);

    expect(addSpy).toHaveBeenCalledWith(archiveOf(resource));
  });

  describe('reading the archive', () => {
    const respondWith = (...responses: Response[]) => {
      const fetchSpy = vi.spyOn(global, 'fetch');
      responses.forEach(response => fetchSpy.mockResolvedValueOnce(response));
      return fetchSpy;
    };
    const bytes = (n: number, headers: Record<string, string> = {}, status = 206) => new Response(new Uint8Array(n), { status, headers: { 'content-length': `${n}`, ...headers } });
    const wafChallenge = () =>
      new Response(null, { status: 202, headers: { 'x-amzn-waf-action': 'challenge', 'content-type': 'text/html; charset=UTF-8', 'content-length': '0' } });

    it('reads the range it was asked for', async () => {
      const fetchSpy = respondWith(bytes(16, { etag: '"a"' }));
      const result = await new CheckedFetchSource(URL).getBytes(100, 16);

      expect(new Headers(fetchSpy.mock.calls[0][1]?.headers).get('range')).toEqual('bytes=100-115');
      expect(result.data.byteLength).toEqual(16);
      expect(result.etag).toEqual('"a"');
    });

    it('sends the headers and credentials it was given', async () => {
      const fetchSpy = respondWith(bytes(16));
      await new CheckedFetchSource(URL, new Headers({ Authorization: 'Bearer token' }), 'include').getBytes(0, 16);

      const init = fetchSpy.mock.calls[0][1];
      expect(new Headers(init?.headers).get('authorization')).toEqual('Bearer token');
      expect(init?.credentials).toEqual('include');
    });

    it('refuses a bot check instead of handing its empty body on as the archive', async () => {
      respondWith(wafChallenge());
      await expect(new CheckedFetchSource(URL).getBytes(0, 16384)).rejects.toBeInstanceOf(ChallengeError);
    });

    it('fails to open a challenged archive with the challenge, not a DataView RangeError', async () => {
      respondWith(wafChallenge());
      const resource = new PMTilesResource('id', 'https://hgl.harvard.edu/data/public/TG00MIPLC00.pmtiles');

      await expect(resource.isVector()).rejects.toMatchObject({ name: 'ChallengeError', host: 'hgl.harvard.edu' });
    });

    it('refuses a login page', async () => {
      respondWith(new Response('<!DOCTYPE html>', { status: 200, headers: { 'content-type': 'text/html;charset=utf-8', 'content-length': '15' } }));
      await expect(new CheckedFetchSource(URL).getBytes(0, 16384)).rejects.toBeInstanceOf(SignInError);
    });

    it('reports the status a refused read came back with', async () => {
      respondWith(new Response('', { status: 403, statusText: 'Forbidden' }));
      await expect(new CheckedFetchSource(URL).getBytes(0, 16)).rejects.toMatchObject({ name: 'HttpError', status: 403 });
    });

    it('refuses a whole file handed back for a range read', async () => {
      respondWith(bytes(4096, {}, 200));
      await expect(new CheckedFetchSource(URL).getBytes(0, 512)).rejects.toThrow('HTTP Byte Serving');
    });

    it('asks again for exactly what a small archive holds when the header read runs past its end', async () => {
      const fetchSpy = respondWith(new Response('', { status: 416, headers: { 'content-range': 'bytes */900' } }), bytes(900));
      const result = await new CheckedFetchSource(URL).getBytes(0, 16384);

      expect(new Headers(fetchSpy.mock.calls[1][1]?.headers).get('range')).toEqual('bytes=0-899');
      expect(result.data.byteLength).toEqual(900);
    });

    it('flags an archive that changed underneath it, so PMTiles reloads and retries', async () => {
      respondWith(bytes(16, { etag: '"second"' }));
      const source = new CheckedFetchSource(URL);

      await expect(source.getBytes(0, 16, undefined, '"first"')).rejects.toBeInstanceOf(EtagMismatch);
      expect(source.mustReload).toBe(true);
    });
  });

  describe('bounds', () => {
    const header = { minLon: -123.532115, minLat: 36.893111, maxLon: -121.208298, maxLat: 38.864317 };
    const recordBounds: [[number, number], [number, number]] = [
      [0, 0],
      [1, 1],
    ];
    const headerOf = (resource: PMTilesResource) => vi.spyOn(archiveOf(resource), 'getHeader').mockResolvedValue(header);

    it('frames the map on the box the record carried, without reading the header', async () => {
      const resource = new PMTilesResource('id', URL, recordBounds);
      const getHeader = headerOf(resource);

      expect(await resource.getBounds()).toBe(recordBounds);
      expect(getHeader).not.toHaveBeenCalled();
    });

    it('falls back on the extent in its header when the record carried none', async () => {
      const resource = new PMTilesResource('id', URL);
      headerOf(resource);

      expect(await resource.getBounds()).toEqual([
        [-123.532115, 36.893111],
        [-121.208298, 38.864317],
      ]);
    });

    it('reports the extent in its header whatever the record said', async () => {
      const resource = new PMTilesResource('id', URL, recordBounds);
      headerOf(resource);

      expect(await resource.getReportedBounds()).toEqual([
        [-123.532115, 36.893111],
        [-121.208298, 38.864317],
      ]);
    });
  });
});
