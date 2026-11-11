import { DEFAULT_CONCURRENCY_LIMITER } from '@developmentseed/deck.gl-geotiff';
import { GeoTIFF } from '@developmentseed/geotiff';
import { DEFAULT_MAX_REQUEST_BYTES, RangeReader } from '@developmentseed/range-reader';

import { assertData, HttpError } from './errors';
import { resolveRequest, type RequestTransform } from './request';

// A reader's cache can't see the headers or URL a transform adds, so each transform gets its own reader.
const readers = new WeakMap<RequestTransform, RangeReader>();
let untransformedReader: RangeReader | undefined;

function readerFor(transform?: RequestTransform): RangeReader {
  if (!transform) return (untransformedReader ??= new RangeReader({ fetch: transformedFetch() }));

  let reader = readers.get(transform);
  if (!reader) {
    reader = new RangeReader({ fetch: transformedFetch(transform) });
    readers.set(transform, reader);
  }
  return reader;
}

/**
 * Apply the request transform to each range request, and throw our own errors so a failed read keeps its status.
 * The reader would otherwise report a non-2xx as a bare message, and treat a 404 as an empty read.
 */
export function transformedFetch(transform?: RequestTransform): typeof fetch {
  return async (input, init) => {
    const href = input instanceof URL ? input.href : typeof input === 'string' ? input : input.url;
    const { url, init: transformed } = resolveRequest(href, 'tile', transform);

    const headers = new Headers(init?.headers);
    for (const [name, value] of Object.entries(transformed?.headers ?? {})) headers.set(name, value);
    const response = await fetch(url, { ...init, ...transformed, headers });

    try {
      assertData(response, href);
      if (!response.ok) throw new HttpError(href, response.status, response.statusText);
      if (ignoredRange(response, headers)) throw new Error(`${href} sent the whole file instead of the part asked for, so its server does not support range requests`);
    } catch (error) {
      void response.body?.cancel().catch(() => {});
      throw error;
    }

    return response;
  };
}

// The reader keeps a whole file that fits in one request; refuse anything bigger rather than download all of it.
function ignoredRange(response: Response, headers: Headers): boolean {
  if (response.status !== 200 || !headers.has('range')) return false;

  const length = Number(response.headers.get('content-length') ?? NaN);
  return !Number.isFinite(length) || length > DEFAULT_MAX_REQUEST_BYTES;
}

export async function openGeoTIFF(url: string, requestTransform?: RequestTransform, signal?: AbortSignal): Promise<GeoTIFF> {
  const resolved = new URL(url, typeof document === 'undefined' ? undefined : document.baseURI);

  return await GeoTIFF.fromUrl(resolved, { reader: readerFor(requestTransform), signal, concurrencyLimiter: DEFAULT_CONCURRENCY_LIMITER });
}
