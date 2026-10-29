import { describe, it, expect, vi, afterEach } from '@stencil/vitest';
import { Protocol } from 'pmtiles';

import PMTilesResource from './pmtiles';
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
