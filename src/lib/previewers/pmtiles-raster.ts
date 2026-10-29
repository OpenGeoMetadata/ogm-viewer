import RasterPreviewer from './raster';
import type { AddRasterSourceObject } from './raster';

export default class PMTilesRasterPreviewer extends RasterPreviewer {
  protected getSourceId(): string {
    return `${this.resource.id}-pmtiles`;
  }

  protected async createSources(): Promise<AddRasterSourceObject[]> {
    return [
      {
        id: this.getSourceId(),
        type: 'raster',
        url: await this.resource.getMapLibreSourceUrl(),
      },
    ];
  }
}
