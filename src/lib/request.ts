import type { RequestParameters, ResourceType } from 'maplibre-gl';

// Distinguishes a metadata request - a JSON/XML document describing a resource - from a tile
// request - the pixels or vectors of one map tile - so a transform can treat them differently,
// e.g. attaching an auth header only where a server actually requires one.
export type RequestResourceType = 'metadata' | 'tile';

// What a RequestTransform can change about a request. Deliberately a subset of MapLibre's own
// RequestParameters, so the same value can drive both a plain fetch() and, once adapted (see
// toMapLibreRequest), MapLibre's own transformRequest option.
export type TransformedRequest = {
  url?: string;
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
};

/**
 * Given a URL, decide how the request for it should actually be made - e.g. attaching an
 * Authorization header, or opting into cookies via `credentials: 'include'`, for a resource that
 * needs authorization. Returning undefined leaves the request as-is.
 *
 * Mirrors MapLibre's own transformRequest, so one function can drive both: a Resource's own
 * fetches, and - once its previewer attaches to a map - MapLibre's own tile and style requests.
 * Synchronous, unlike MapLibre's: it has to run inline as the user pans and zooms, so a token or
 * other credential it needs should already be in hand by the time it's given to a Resource,
 * rather than fetched on demand here.
 *
 * A transform that attaches credentials should still check the URL - MapLibre calls the same
 * function for a basemap's own style, glyphs and sprites, which are a different, unrelated origin.
 */
export type RequestTransform = (url: string, resourceType: RequestResourceType) => TransformedRequest | undefined;

// Apply a RequestTransform, if there is one, producing what fetch() (or fetchOrThrow()) need.
export function resolveRequest(url: string, resourceType: RequestResourceType, transform?: RequestTransform): { url: string; init?: RequestInit } {
  const transformed = transform?.(url, resourceType);
  if (!transformed) return { url };

  const init: RequestInit = {};
  if (transformed.headers) init.headers = transformed.headers;
  if (transformed.credentials) init.credentials = transformed.credentials;
  return { url: transformed.url ?? url, init };
}

// MapLibre's own request types, reduced to ours. Only 'Tile' is pixel/vector tile data;
// everything else it asks about - Style, Source, Glyphs, Sprite*, Image - is a document, same as
// the metadata a Resource fetches for itself.
export function ourResourceType(maplibreType?: ResourceType): RequestResourceType {
  return maplibreType === 'Tile' ? 'tile' : 'metadata';
}

// Adapt a RequestTransform's result into the shape MapLibre's transformRequest option wants. Used
// by ogm-map, which applies the same transform a previewer's resource uses for its own requests to
// every request MapLibre makes on its own - see MapPreviewer.requestTransform.
export function toMapLibreRequest(transformed: TransformedRequest | undefined, url: string): RequestParameters | undefined {
  if (!transformed) return undefined;

  return {
    url: transformed.url ?? url,
    headers: transformed.headers,
    // MapLibre doesn't accept 'omit' - it's the default, so there's nothing to pass through for it.
    credentials: transformed.credentials === 'omit' ? undefined : transformed.credentials,
  };
}
