import { describe, it, expect } from '@stencil/vitest';
import type { ResourceType } from 'maplibre-gl';

import { ourResourceType, resolveRequest, toMapLibreRequest, type RequestTransform } from './request';

const URL = 'https://example.com/data.json';

describe('resolveRequest', () => {
  it('leaves the request alone when there is no transform', () => {
    expect(resolveRequest(URL, 'metadata')).toEqual({ url: URL });
  });

  it('leaves the request alone when the transform declines this url', () => {
    const transform: RequestTransform = () => undefined;
    expect(resolveRequest(URL, 'metadata', transform)).toEqual({ url: URL });
  });

  it('carries headers into RequestInit', () => {
    const transform: RequestTransform = () => ({ headers: { Authorization: 'Bearer token' } });
    expect(resolveRequest(URL, 'metadata', transform)).toEqual({ url: URL, init: { headers: { Authorization: 'Bearer token' } } });
  });

  it('carries credentials into RequestInit', () => {
    const transform: RequestTransform = () => ({ credentials: 'include' });
    expect(resolveRequest(URL, 'metadata', transform)).toEqual({ url: URL, init: { credentials: 'include' } });
  });

  it('lets the transform rewrite the url', () => {
    const rewritten = 'https://proxy.example.com/data.json';
    const transform: RequestTransform = () => ({ url: rewritten });
    expect(resolveRequest(URL, 'metadata', transform)).toEqual({ url: rewritten, init: {} });
  });

  it('produces an unset RequestInit when the transform changes nothing about the request', () => {
    const transform: RequestTransform = () => ({});
    expect(resolveRequest(URL, 'metadata', transform)).toEqual({ url: URL, init: {} });
  });

  it('tells the transform what kind of request this is', () => {
    const seen: string[] = [];
    const transform: RequestTransform = (_url, resourceType) => {
      seen.push(resourceType);
      return undefined;
    };

    resolveRequest(URL, 'tile', transform);
    expect(seen).toEqual(['tile']);
  });
});

describe('ourResourceType', () => {
  it('treats a MapLibre Tile request as ours', () => {
    expect(ourResourceType('Tile' as ResourceType)).toEqual('tile');
  });

  it.each(['Style', 'Source', 'Glyphs', 'SpriteImage', 'SpriteJSON', 'Image', 'Unknown', undefined])(
    'treats a MapLibre %s request as metadata, same as everything a Resource fetches for itself',
    maplibreType => {
      expect(ourResourceType(maplibreType as ResourceType | undefined)).toEqual('metadata');
    },
  );
});

describe('toMapLibreRequest', () => {
  it('returns undefined - leaving the request untouched - when there is nothing to apply', () => {
    expect(toMapLibreRequest(undefined, URL)).toBeUndefined();
  });

  it('defaults the url back to the original when the transform did not set one', () => {
    expect(toMapLibreRequest({ headers: { 'X-Foo': 'bar' } }, URL)).toEqual({ url: URL, headers: { 'X-Foo': 'bar' }, credentials: undefined });
  });

  it('passes through a rewritten url', () => {
    const rewritten = 'https://proxy.example.com/data.json';
    expect(toMapLibreRequest({ url: rewritten }, URL)).toMatchObject({ url: rewritten });
  });

  it("drops 'omit' credentials, which MapLibre's own RequestParameters doesn't accept", () => {
    expect(toMapLibreRequest({ credentials: 'omit' }, URL)?.credentials).toBeUndefined();
  });

  it.each(['include', 'same-origin'] as const)('passes through %s credentials', credentials => {
    expect(toMapLibreRequest({ credentials }, URL)?.credentials).toEqual(credentials);
  });
});
