import { fetchOrThrow } from '../errors';
import MapResource from './map';
import type { ResourceKind } from './resource';

// A single vector layer in a TileJSON tileset
interface VectorLayer {
  id: string;
}

// Vector or raster tileset described in a TileJSON document at a URL
export default class TileJsonResource extends MapResource {
  readonly kind: ResourceKind = 'tilejson';

  // Metadata parsed from TileJSON document
  private metadata: any;

  label() {
    return 'TileJSON';
  }

  getMapLibreSourceUrl() {
    return this.url;
  }

  getScheme() {
    return undefined;
  }

  // Fetch and memoize metadata
  protected async getMetadata() {
    if (!this.metadata) {
      const resp = await fetchOrThrow(this.url);
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

  // Used to zoom the map to the data once loaded; bounds are optional in TileJSON, and
  // without them we leave the camera wherever it already is
  async getBounds() {
    if (this.bounds) return this.bounds;
    const metadata = await this.getMetadata();
    if (!metadata.bounds) return undefined;
    return [
      [metadata.bounds[0], metadata.bounds[1]],
      [metadata.bounds[2], metadata.bounds[3]],
    ] as [[number, number], [number, number]];
  }

  // TileJSON has no tileSize of its own, though some services add one to the document. Raster
  // tiles served from a {z}/{x}/{y} template are 256px by convention, so assume that otherwise;
  // MapLibre would default to 512 and draw them upscaled and blurry.
  async getTileSize(): Promise<number> {
    const metadata = await this.getMetadata();
    return metadata.tileSize ?? 256;
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
