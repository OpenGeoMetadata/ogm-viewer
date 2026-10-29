import { fetchOrThrow } from '../errors';
import { resolveRequest } from '../request';
import MapResource from './map';
import type { ResourceKind } from './resource';

interface VectorLayer {
  id: string;
}

export default class TileJsonResource extends MapResource {
  readonly kind: ResourceKind = 'tilejson';

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

  protected async getMetadata() {
    if (!this.metadata) {
      const { url, init } = resolveRequest(this.url, 'metadata', this.requestTransform);
      const resp = await fetchOrThrow(url, init);
      this.metadata = await resp.json();
    }
    return this.metadata;
  }

  async isVector() {
    const metadata = await this.getMetadata();
    const template = metadata.tiles[0];
    const pathname = new URL(template).pathname;
    return pathname.endsWith('.pbf') || pathname.endsWith('.mvt') || pathname.endsWith('.mlt');
  }

  async getReportedBounds() {
    const metadata = await this.getMetadata();
    if (!metadata.bounds) return undefined;
    return [
      [metadata.bounds[0], metadata.bounds[1]],
      [metadata.bounds[2], metadata.bounds[3]],
    ] as [[number, number], [number, number]];
  }

  // TileJSON has no standard tileSize; raster XYZ tiles conventionally use 256px.
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
