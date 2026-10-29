import { FetchSource, PMTiles, Protocol, TileType, Header } from 'pmtiles';
import { addProtocol, type LngLatBoundsLike } from 'maplibre-gl';

import Resource, { type ResourceKind } from './resource';
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
    const source = headers || transformed?.credentials ? new FetchSource(url, headers, credentialsFor(transformed?.credentials)) : url;
    this.archive = new PMTiles(source);

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
