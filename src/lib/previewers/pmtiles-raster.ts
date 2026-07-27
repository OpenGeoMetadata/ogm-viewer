import RasterPreviewer from './raster';
import PMTilesResource from '../resources/pmtiles';
import type { AddRasterSourceObject } from './raster';

export default class PMTilesRasterPreviewer extends RasterPreviewer {
  // An archive has no scheme to name it by, and the raster layer draws from this too
  protected getSourceId(): string {
    return `${this.resource.id}-pmtiles`;
  }

  // PMTiles sources use 'url' instead of 'tiles' and have no scheme or tileSize
  protected async createSources(): Promise<AddRasterSourceObject[]> {
    return [
      {
        id: this.getSourceId(),
        type: 'raster',
        url: await this.resource.getMapLibreSourceUrl(),
      },
    ];
  }

  // Raster PMTiles have bounds info in the header
  async getBounds(): Promise<maplibregl.LngLatBoundsLike | undefined> {
    return await (this.resource as unknown as PMTilesResource).getBounds();
  }
}
