import type { RequestParameters, ResourceType } from 'maplibre-gl';

export type RequestResourceType = 'metadata' | 'tile';

export type TransformedRequest = {
  url?: string;
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
};

/** Return undefined to leave the request unchanged; otherwise override its URL, headers, or credentials. */
export type RequestTransform = (url: string, resourceType: RequestResourceType) => TransformedRequest | undefined;

export function resolveRequest(url: string, resourceType: RequestResourceType, transform?: RequestTransform): { url: string; init?: RequestInit } {
  const transformed = transform?.(url, resourceType);
  if (!transformed) return { url };

  const init: RequestInit = {};
  if (transformed.headers) init.headers = transformed.headers;
  if (transformed.credentials) init.credentials = transformed.credentials;
  return { url: transformed.url ?? url, init };
}

export function ourResourceType(maplibreType?: ResourceType): RequestResourceType {
  return maplibreType === 'Tile' ? 'tile' : 'metadata';
}

export function toMapLibreRequest(transformed: TransformedRequest | undefined, url: string): RequestParameters | undefined {
  if (!transformed) return undefined;

  return {
    url: transformed.url ?? url,
    headers: transformed.headers,
    credentials: transformed.credentials === 'omit' ? undefined : transformed.credentials,
  };
}
