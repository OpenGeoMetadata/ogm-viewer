// Adapted from https://github.com/protomaps/PMTiles/blob/main/app/src/tileset.ts

import { PMTiles, TileType, Header } from 'pmtiles';

import Source from './source';
import { type LngLatBoundsLike } from 'maplibre-gl';

// A single vector layer in a PMTiles tileset
interface VectorLayer {
  id: string;
}

// Vector layer metadata stored in PMTiles header
interface Metadata {
  type?: string;
  vector_layers: VectorLayer[];
}

// Vector or raster tileset stored in a PMTiles archive at a URL
export default class PMTilesSource extends Source {
  // PMTiles object for reading metadata and tiles from the archive
  private archive: PMTiles;

  // Memoized PMTiles metadata and header
  private metadata: Metadata;
  private header: Header;

  // Store a reference so we can open the archive for metadata inspection
  constructor(id: string, url: string, bounds?: LngLatBoundsLike) {
    super(id, url, bounds);
    this.archive = new PMTiles(url);
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
