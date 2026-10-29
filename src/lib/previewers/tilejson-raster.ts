import RasterPreviewer from './raster';
import type { AddRasterSourceObject } from './raster';
import type TileJsonSource from '../resources/tilejson';

export default class TileJsonRasterPreviewer extends RasterPreviewer {
  protected async createSources(): Promise<AddRasterSourceObject[]> {
    return [
      {
        id: this.getSourceId(),
        type: 'raster',
        url: await this.resource.getMapLibreSourceUrl(),
        tileSize: await this.tilejson.getTileSize(),
      },
    ];
  }

  protected getSourceId(): string {
    return `${this.resource.id}-tilejson`;
  }

  private get tilejson() {
    return this.resource as unknown as TileJsonSource;
  }
}
