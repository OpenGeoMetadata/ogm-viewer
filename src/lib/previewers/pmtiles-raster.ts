import RasterPreviewer from './raster';
import PMTilesResource from '../resources/pmtiles';
import { RasterSourceSpecification } from 'maplibre-gl';

export default class PMTilesRasterPreviewer extends RasterPreviewer {
  // PMTiles sources use 'url' instead of 'tiles' and have no scheme or tileSize
  protected async createSources(): Promise<RasterSourceSpecification[]> {
    return [
      {
        type: 'raster',
        url: await this.resource.getMapLibreSourceUrl(),
      },
    ];
  }

  protected getSourceId(): string {
    return `${this.resource.id}-pmtiles`;
  }

  // Raster PMTiles have bounds info in the header
  async getBounds(): Promise<maplibregl.LngLatBoundsLike | undefined> {
    return await (this.resource as unknown as PMTilesResource).getBounds();
  }
}
