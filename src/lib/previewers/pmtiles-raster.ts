import RasterPreviewer from './raster';
import PMTilesSource from '../sources/pmtiles';
import { RasterSourceSpecification } from 'maplibre-gl';

export default class PMTilesRasterPreviewer extends RasterPreviewer {
  // PMTiles sources use 'url' instead of 'tiles' and have no scheme or tileSize
  protected async createSource(): Promise<RasterSourceSpecification> {
    return {
      type: 'raster',
      url: await this.source.getSourceUrl(),
    };
  }

  protected getSourceId(): string {
    return `${this.source.id}-pmtiles`;
  }

  // Raster PMTiles have bounds info in the header
  async getBounds(): Promise<maplibregl.LngLatBoundsLike | undefined> {
    return await (this.source as unknown as PMTilesSource).getBounds();
  }
}
