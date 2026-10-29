import { EtagMismatch, FetchSource, PMTiles, Protocol, TileType, type Header, type RangeResponse } from 'pmtiles';
import { addProtocol, type LngLatBoundsLike } from 'maplibre-gl';

import Resource, { type ResourceKind } from './resource';
import { assertData, HttpError } from '../errors';
import type { RequestTransform } from '../request';

interface VectorLayer {
  id: string;
}

interface Metadata {
  type?: string;
  vector_layers: VectorLayer[];
}

const protocol = new Protocol();
addProtocol('pmtiles', protocol.tile);

// Adapted from FetchSource.getBytes in pmtiles 4.4.1, with changes so we can check
// the response. Needed so we can raise if we get blocked by bot protection or login.
export class CheckedFetchSource extends FetchSource {
  async getBytes(offset: number, length: number, passedSignal?: AbortSignal, etag?: string): Promise<RangeResponse> {
    const controller = passedSignal ? undefined : new AbortController();
    const signal = passedSignal ?? controller?.signal;

    const headers = new Headers(this.customHeaders);
    headers.set('range', `bytes=${offset}-${offset + length - 1}`);

    let cache: RequestCache | undefined;
    if (this.mustReload) cache = 'reload';
    else if (this.chromeWindowsNoCache) cache = 'no-store';

    let response = await fetch(this.url, { signal, cache, headers, credentials: this.credentials });

    // Some servers refuse a header read that runs past the end of a small archive; ask again for exactly what is there.
    if (offset === 0 && response.status === 416) {
      const contentRange = response.headers.get('content-range');
      if (!contentRange?.startsWith('bytes */')) throw new Error('Missing content-length on 416 response');

      headers.set('range', `bytes=0-${Number(contentRange.slice(8)) - 1}`);
      response = await fetch(this.url, { signal, cache: 'reload', headers, credentials: this.credentials });
    }

    assertData(response, this.url);

    let newEtag = response.headers.get('etag');
    if (newEtag?.startsWith('W/')) newEtag = null;

    if (response.status === 416 || (etag && newEtag && newEtag !== etag)) {
      this.mustReload = true;
      throw new EtagMismatch(`Server returned non-matching ETag ${etag} after one retry. Check browser extensions and servers for issues that may affect correct ETag headers.`);
    }

    if (response.status >= 300) throw new HttpError(this.url, response.status, response.statusText);

    const contentLength = response.headers.get('content-length');
    if (response.status === 200 && (!contentLength || Number(contentLength) > length)) {
      controller?.abort();
      throw new Error('Server returned no content-length header or content-length exceeding request. Check that your storage backend supports HTTP Byte Serving.');
    }

    return {
      data: await response.arrayBuffer(),
      etag: newEtag ?? undefined,
      cacheControl: response.headers.get('cache-control') ?? undefined,
      expires: response.headers.get('expires') ?? undefined,
    };
  }
}

export default class PMTilesResource extends Resource {
  readonly kind: ResourceKind = 'pmtiles';

  private archive: PMTiles;

  private metadata: Metadata;
  private header: Header;

  constructor(id: string, url: string, bounds?: LngLatBoundsLike, requestTransform?: RequestTransform) {
    super(id, url, bounds, requestTransform);

    const transformed = requestTransform?.(url, 'tile');
    const headers = transformed?.headers ? new Headers(transformed.headers) : undefined;
    // Keep the archive lookup URL stable; PMTiles registers it under the original source URL.
    this.archive = new PMTiles(new CheckedFetchSource(url, headers, credentialsFor(transformed?.credentials)));

    // Register the archive even without credentials so tile reads reuse this instance.
    protocol.add(this.archive);
  }

  label() {
    return 'PMTiles';
  }

  protected async getMetadata() {
    if (!this.metadata) {
      this.metadata = (await this.archive.getMetadata()) as Metadata;
    }
    return this.metadata;
  }

  protected async getHeader() {
    if (!this.header) {
      this.header = (await this.archive.getHeader()) as Header;
    }
    return this.header;
  }

  async isVector() {
    const header = await this.getHeader();
    return header.tileType === TileType.Mvt || header.tileType === TileType.Mlt;
  }

  async getReportedBounds() {
    const header = await this.getHeader();
    return [
      [header.minLon, header.minLat],
      [header.maxLon, header.maxLat],
    ] as [[number, number], [number, number]];
  }

  async isOverlay() {
    const m = await this.getMetadata();
    return m.type === 'overlay';
  }

  async getVectorLayers() {
    const m = await this.getMetadata();
    return m.vector_layers.map(l => l.id);
  }

  async getVectorEncoding() {
    const header = await this.getHeader();
    if (header.tileType === TileType.Mvt) return 'mvt';
    if (header.tileType === TileType.Mlt) return 'mlt';
    return undefined;
  }

  getMapLibreSourceUrl() {
    return `pmtiles://${this.url}`;
  }

  getScheme() {
    return undefined;
  }

  getTileSize() {
    return undefined;
  }

  async getMapLibreSourceType() {
    if (await this.isVector()) return 'vector' as const;
    return 'raster' as const;
  }
}

function credentialsFor(credentials?: RequestCredentials): 'same-origin' | 'include' | undefined {
  return credentials === 'omit' ? undefined : credentials;
}
