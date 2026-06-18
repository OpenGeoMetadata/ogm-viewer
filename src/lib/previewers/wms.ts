import RasterPreviewer from './raster';
import type WmsSource from '../sources/wms';
import { RasterSourceSpecification } from 'maplibre-gl';

export default class WmsPreviewer extends RasterPreviewer {
  declare protected source: WmsSource;

  // WMS sources have no scheme
  protected async createSource(): Promise<RasterSourceSpecification> {
    return {
      type: 'raster',
      tiles: [await this.source.getSourceUrl()],
      tileSize: this.source.getTileSize(),
    };
  }

  protected getSourceId(): string {
    return `${this.source.id}-wms`;
  }
}
