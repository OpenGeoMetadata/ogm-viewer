import { SourceCache, SourceChunk } from '@chunkd/middleware';
import { ContentRange, SourceError, SourceView, type Source, type SourceMetadata } from '@chunkd/source';
import { GeoTIFF } from '@developmentseed/geotiff';

import { resolveRequest, type RequestResourceType, type RequestTransform } from './request';

// The same numbers GeoTIFF.fromUrl reads a public COG with, so an authenticated one opens in as few
// requests: 64 KiB blocks, and 8 MiB of them kept.
const CHUNK_SIZE = 64 * 1024;
const CACHE_SIZE = 8 * 1024 * 1024;

// Reads a COG over HTTP with a RequestTransform applied to every request, so a restricted one can be
// drawn by deck.gl rather than only by the MapLibre protocol - which matters because that protocol
// only handles COGs already in Web Mercator, and a scan that is both reprojected and restricted had
// nothing that could draw it.
//
// @chunkd's own SourceHttp does carry per-instance headers, but nothing else a transform can return:
// the fetch it goes through is a single static shared by every source on the page, so cookies can't be
// opted into for one COG without opting in for all of them. Implementing Source is the way in that
// GeoTIFF.open documents, and there is little to it - the Range and metadata handling below is the
// whole of what SourceHttp does.
export class TransformedGeoTIFFSource implements Source {
  readonly type = 'http';
  readonly url: URL;

  // Read by the layers above once either method has answered; see readMetadata for the one field of it
  // that has to be treated carefully.
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

  // A HEAD is the one response whose Content-Length is the length of the whole file, so it is also the
  // only place the size can simply be read off.
  private async readHead(signal?: AbortSignal): Promise<SourceMetadata> {
    try {
      const response = await this.request('metadata', { method: 'HEAD', signal });
      if (!response.ok) throw new SourceError(`Failed to HEAD ${this.url.href}`, response.status, this, new Error(response.statusText));

      const size = Number(response.headers.get('content-length'));
      this.metadata = { ...this.readMetadata(response), size: Number.isFinite(size) ? size : undefined };
      return this.metadata;
    } catch (error) {
      // One refused HEAD shouldn't be the answer for the rest of the session: a session can be
      // established, or a token renewed, between one attempt and the next.
      this.headed = undefined;
      throw error;
    }
  }

  async fetch(offset: number, length?: number, options?: { signal: AbortSignal }): Promise<ArrayBuffer> {
    const range = ContentRange.toRange(offset, length);

    try {
      const response = await this.request('tile', { headers: { range }, signal: options?.signal });
      if (!response.ok) throw new SourceError(`Failed to fetch ${this.url.href} ${range}`, response.status, this, new Error(response.statusText));

      // A changed ETag means the file was replaced between reads, so the bytes already held describe a
      // different image than the ones just arrived. Reported rather than quietly mixed, as SourceHttp does.
      const metadata = this.readMetadata(response);
      if (this.metadata?.eTag && metadata.eTag && this.metadata.eTag !== metadata.eTag) {
        throw new SourceError(`ETag conflict ${this.url.href} ${range} expected: ${this.metadata.eTag} got: ${metadata.eTag}`, 409, this);
      }

      const body = await response.arrayBuffer();

      // A server with no Range support answers a range read with the whole file and a 200, and that is
      // a failure that hides. The bytes still parse as a TIFF header, since that is what the start of
      // the file is, so the COG opens and reports its size and extent correctly; only the tiles are
      // wrong, and a decoder handed a file header where it expected a compressed tile reports a corrupt
      // codec stream. The error then names the codec and says nothing about the server. Worth catching
      // by hand because it is not exotic: Stencil's own dev server is one of these, so a COG served
      // from `npm start` fails exactly this way.
      //
      // 206 is what a served range comes back with. A 200 is allowed to mean "the range was the whole
      // file" - which is why the body is measured rather than the status trusted: only a body longer
      // than the range asked for can be a range that wasn't honoured.
      if (response.status !== 206 && length !== undefined && body.byteLength > length) {
        throw new SourceError(`Asked ${this.url.href} for ${range} and got all ${body.byteLength} bytes of it, so this server does not support range requests`, 501, this);
      }

      this.metadata ??= metadata;
      return body;
    } catch (error) {
      // Ours already names what happened and with which status. Anything else - a dropped connection, a
      // refused preflight - arrives as a bare TypeError, which the layers above can make nothing of.
      if (SourceError.is(error) && error.source === this) throw error;
      throw new SourceError(`Failed to fetch ${this.url.href} ${range}`, 500, this, error);
    }
  }

  // Deliberately not @chunkd's own getMetadataFromResponse, which takes `size` from Content-Length and
  // only then lets Content-Range override it. On a range response Content-Length is the length of the
  // chunk rather than of the file, and a browser can read Content-Range only where the server lists it
  // in Access-Control-Expose-Headers, which S3 does not by default. The size recorded would be one
  // chunk, and every read past it refused as beyond the end of the file. So it comes from Content-Range
  // alone here, and otherwise stays unknown until something asks for a HEAD.
  // See: https://github.com/developmentseed/deck.gl-raster/issues/524
  private readMetadata(response: Response): SourceMetadata {
    const contentRange = response.headers.get('content-range');

    return {
      size: contentRange ? ContentRange.parseSize(contentRange) : undefined,
      eTag: response.headers.get('etag') ?? undefined,
      contentType: response.headers.get('content-type') ?? undefined,
      contentEncoding: response.headers.get('content-encoding') ?? undefined,
    };
  }

  // Resolved per request rather than once in the constructor, matching every other call site: the
  // transform is a plain function of the URL, and a COG stays open across as many reads as the user
  // cares to pan through.
  private async request(resourceType: RequestResourceType, init: { method?: string; headers?: Record<string, string>; signal?: AbortSignal }): Promise<Response> {
    const { url, init: transformed } = resolveRequest(this.url.href, resourceType, this.requestTransform);
    const response = await fetch(url, { ...init, ...transformed, headers: { ...init.headers, ...transformed?.headers } });

    // A file server that wants authentication doesn't have to say so with a status. Stanford's answers
    // an unauthenticated range read with a 302 to the identity provider, which fetch follows, and the
    // login page comes back as a 206 - the right status, the range honoured, and HTML in the body. Left
    // alone those bytes reach the TIFF parser and fail there as a malformed header, which says nothing
    // about what actually went wrong. No COG is ever served as a page, so this is safe to refuse.
    if (response.ok && response.headers.get('content-type')?.startsWith('text/html')) {
      throw new SourceError(`Asked to sign in before reading ${this.url.href}`, 401, this);
    }

    return response;
  }
}

// Mirrors what GeoTIFF.fromUrl builds, over a source that can carry a transform. Tile data reads go to
// the raw source as they do there, bypassing the header cache: they are read once and handed to the
// decoder, so caching them would only copy them.
export async function openGeoTIFF(url: string, requestTransform?: RequestTransform, signal?: AbortSignal): Promise<GeoTIFF> {
  const source = new TransformedGeoTIFFSource(url, requestTransform);
  const headerSource = new SourceView(source, [new SourceChunk({ size: CHUNK_SIZE }), new SourceCache({ size: CACHE_SIZE })]);

  return await GeoTIFF.open({ dataSource: source, headerSource, signal });
}
