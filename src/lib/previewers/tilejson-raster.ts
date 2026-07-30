import RasterPreviewer from './raster';
import type { AddRasterSourceObject } from './raster';
import type TileJsonSource from '../resources/tilejson';

export default class TileJsonRasterPreviewer extends RasterPreviewer {
  // Handed the URL of the document, MapLibre reads it itself and takes the tile templates, zoom
  // range and scheme from there; only the tile size has to come from us
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

  // A record can reference the same tileset both ways, so keep the two sources distinct
  protected getSourceId(): string {
    return `${this.resource.id}-tilejson`;
  }

  // A TileJSON document can describe either kind of tileset, so its source isn't a RasterSource
  private get tilejson() {
    return this.resource as unknown as TileJsonSource;
  }
}
