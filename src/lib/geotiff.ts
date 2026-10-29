import { SourceCache, SourceChunk } from '@chunkd/middleware';
import { ContentRange, SourceError, SourceView, type Source, type SourceMetadata } from '@chunkd/source';
import { GeoTIFF } from '@developmentseed/geotiff';

import { resolveRequest, type RequestResourceType, type RequestTransform } from './request';

const CHUNK_SIZE = 64 * 1024;
const CACHE_SIZE = 8 * 1024 * 1024;

export class TransformedGeoTIFFSource implements Source {
  readonly type = 'http';
  readonly url: URL;

  metadata?: SourceMetadata;

  private headed?: Promise<SourceMetadata>;

  constructor(
    url: string | URL,
    private requestTransform?: RequestTransform,
  ) {
    this.url = typeof url === 'string' ? new URL(url, typeof document === 'undefined' ? undefined : document.baseURI) : url;
  }

  async head(options?: { signal: AbortSignal }): Promise<SourceMetadata> {
    this.headed ??= this.readHead(options?.signal);
    return await this.headed;
  }

  private async readHead(signal?: AbortSignal): Promise<SourceMetadata> {
    try {
      const response = await this.request('metadata', { method: 'HEAD', signal });
      if (!response.ok) throw new SourceError(`Failed to HEAD ${this.url.href}`, response.status, this, new Error(response.statusText));

      const size = Number(response.headers.get('content-length'));
      this.metadata = { ...this.readMetadata(response), size: Number.isFinite(size) ? size : undefined };
      return this.metadata;
    } catch (error) {
      this.headed = undefined;
      throw error;
    }
  }

  async fetch(offset: number, length?: number, options?: { signal: AbortSignal }): Promise<ArrayBuffer> {
    const range = ContentRange.toRange(offset, length);

    try {
      const response = await this.request('tile', { headers: { range }, signal: options?.signal });
      if (!response.ok) throw new SourceError(`Failed to fetch ${this.url.href} ${range}`, response.status, this, new Error(response.statusText));

      const metadata = this.readMetadata(response);
      if (this.metadata?.eTag && metadata.eTag && this.metadata.eTag !== metadata.eTag) {
        throw new SourceError(`ETag conflict ${this.url.href} ${range} expected: ${this.metadata.eTag} got: ${metadata.eTag}`, 409, this);
      }

      const body = await response.arrayBuffer();

      // Reject servers that ignore Range requests; silently downloading the entire COG can exhaust memory.
      if (response.status !== 206 && length !== undefined && body.byteLength > length) {
        throw new SourceError(`Asked ${this.url.href} for ${range} and got all ${body.byteLength} bytes of it, so this server does not support range requests`, 501, this);
      }

      this.metadata ??= metadata;
      return body;
    } catch (error) {
      if (SourceError.is(error) && error.source === this) throw error;
      throw new SourceError(`Failed to fetch ${this.url.href} ${range}`, 500, this, error);
    }
  }

  // For range responses, Content-Length is the chunk size; Content-Range holds the file size.
  private readMetadata(response: Response): SourceMetadata {
    const contentRange = response.headers.get('content-range');

    return {
      size: contentRange ? ContentRange.parseSize(contentRange) : undefined,
      eTag: response.headers.get('etag') ?? undefined,
      contentType: response.headers.get('content-type') ?? undefined,
      contentEncoding: response.headers.get('content-encoding') ?? undefined,
    };
  }

  private async request(resourceType: RequestResourceType, init: { method?: string; headers?: Record<string, string>; signal?: AbortSignal }): Promise<Response> {
    const { url, init: transformed } = resolveRequest(this.url.href, resourceType, this.requestTransform);
    const response = await fetch(url, { ...init, ...transformed, headers: { ...init.headers, ...transformed?.headers } });

    // An authentication redirect can return a successful HTML login page instead of TIFF bytes.
    if (response.ok && response.headers.get('content-type')?.startsWith('text/html')) {
      throw new SourceError(`Asked to sign in before reading ${this.url.href}`, 401, this);
    }

    return response;
  }
}

export async function openGeoTIFF(url: string, requestTransform?: RequestTransform, signal?: AbortSignal): Promise<GeoTIFF> {
  const source = new TransformedGeoTIFFSource(url, requestTransform);
  const headerSource = new SourceView(source, [new SourceChunk({ size: CHUNK_SIZE }), new SourceCache({ size: CACHE_SIZE })]);

  return await GeoTIFF.open({ dataSource: source, headerSource, signal });
}
