import Source from './source';

// A single vector layer in a TileJSON tileset
interface VectorLayer {
  id: string;
}

// Vector or raster tileset described in a TileJSON document at a URL
export default class TileJSONSource extends Source {
  // Metadata parsed from TileJSON document
  private metadata: any;

  label() {
    return 'TileJSON';
  }

  // Fetch and memoize metadata
  protected async getMetadata() {
    if (!this.metadata) {
      const resp = await fetch(this.url);
      this.metadata = await resp.json();
    }
    return this.metadata;
  }

  // Determined by filename
  async isVector() {
    const metadata = await this.getMetadata();
    const template = metadata.tiles[0];
    const pathname = new URL(template).pathname;
    return pathname.endsWith('.pbf') || pathname.endsWith('.mvt') || pathname.endsWith('.mlt');
  }

  // Used to zoom the map to the data once loaded
  async getBounds() {
    if (this.bounds) return this.bounds;
    const metadata = await this.getMetadata();
    return [
      [metadata.bounds[0], metadata.bounds[1]],
      [metadata.bounds[2], metadata.bounds[3]],
    ] as [[number, number], [number, number]];
  }

  async getVectorLayers() {
    const metadata = await this.getMetadata();
    return metadata.vector_layers.map((l: VectorLayer) => l.id);
  }

  async getVectorEncoding() {
    const metadata = await this.getMetadata();
    const template = metadata.tiles[0];
    const pathname = new URL(template).pathname;
    if (pathname.endsWith('.mlt')) return 'mlt';
    return 'mvt';
  }

  async getMapLibreSourceType() {
    if (await this.isVector()) return 'vector' as const;
    return 'raster' as const;
  }
}
