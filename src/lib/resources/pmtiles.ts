// Adapted from https://github.com/protomaps/PMTiles/blob/main/app/src/tileset.ts

import { FetchSource, PMTiles, Protocol, TileType, Header } from 'pmtiles';
import maplibregl, { type LngLatBoundsLike } from 'maplibre-gl';

import Resource, { type ResourceKind } from './resource';
import type { RequestTransform } from '../request';

// A single vector layer in a PMTiles tileset
interface VectorLayer {
  id: string;
}

// Vector layer metadata stored in PMTiles header
interface Metadata {
  type?: string;
  vector_layers: VectorLayer[];
}

// Shared by every PMTiles archive on the page - a MapLibre protocol handler is registered once,
// globally, for the 'pmtiles://' scheme, however many resources or maps use it.
const protocol = new Protocol();
maplibregl.addProtocol('pmtiles', protocol.tile);

// Vector or raster tileset stored in a PMTiles archive at a URL
export default class PMTilesResource extends Resource {
  readonly kind: ResourceKind = 'pmtiles';

  // PMTiles object for reading metadata and tiles from the archive
  private archive: PMTiles;

  // Memoized PMTiles metadata and header
  private metadata: Metadata;
  private header: Header;

  // Store a reference so we can open the archive for metadata inspection
  constructor(id: string, url: string, bounds?: LngLatBoundsLike, requestTransform?: RequestTransform) {
    super(id, url, bounds, requestTransform);

    const transformed = requestTransform?.(url, 'tile');
    const headers = transformed?.headers ? new Headers(transformed.headers) : undefined;
    // A transform that rewrote the URL is ignored here: the protocol handler above looks archives
    // up by the exact URL getMapLibreSourceUrl() embeds in the pmtiles:// source, so this instance
    // has to be keyed by this.url to ever be found once a map asks for tiles from it.
    const source = headers || transformed?.credentials ? new FetchSource(url, headers, credentialsFor(transformed?.credentials)) : url;
    this.archive = new PMTiles(source);

    // Registering unconditionally, not just for authenticated archives, means the protocol
    // handler reuses this instance for tile reads instead of lazily opening its own second,
    // unauthenticated PMTiles - sharing one header/tile cache either way.
    protocol.add(this.archive);
  }

  label() {
    return 'PMTiles';
  }

  // Fetch and memoize PMTiles metadata
  protected async getMetadata() {
    if (!this.metadata) {
      this.metadata = (await this.archive.getMetadata()) as Metadata;
    }
    return this.metadata;
  }

  // Fetch and memoize PMTiles header
  protected async getHeader() {
    if (!this.header) {
      this.header = (await this.archive.getHeader()) as Header;
    }
    return this.header;
  }

  // Determined by encoding
  async isVector() {
    const header = await this.getHeader();
    return header.tileType === TileType.Mvt || header.tileType === TileType.Mlt;
  }

  // Used to zoom the map to the data once loaded
  async getBounds() {
    if (this.bounds) return this.bounds;
    const header = await this.getHeader();
    return [
      [header.minLon, header.minLat],
      [header.maxLon, header.maxLat],
    ] as [[number, number], [number, number]];
  }

  // PMTiles can be used as a basemap, but the default is overlay
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

  // Appends the pmtiles:// protocol; must be registered first to work
  getMapLibreSourceUrl() {
    return `pmtiles://${this.url}`;
  }

  // Raster PMTiles have no specific scheme identifier for MapLibre
  getScheme() {
    return undefined;
  }

  // We don't need to set an explicit tile size for raster PMTiles
  getTileSize() {
    return undefined;
  }

  async getMapLibreSourceType() {
    if (await this.isVector()) return 'vector' as const;
    return 'raster' as const;
  }
}

// Narrow a RequestTransform's credentials to what FetchSource accepts. 'omit' is the default -
// don't send cookies - so there's nothing for FetchSource to do differently for it.
function credentialsFor(credentials?: RequestCredentials): 'same-origin' | 'include' | undefined {
  return credentials === 'omit' ? undefined : credentials;
}
