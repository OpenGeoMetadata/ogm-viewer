import type { RasterSourceSpecification } from 'maplibre-gl';

import RasterPreviewer from './raster';
import type TileJSONSource from '../sources/tilejson';

export default class TileJSONRasterPreviewer extends RasterPreviewer {
  // Handed the URL of the document, MapLibre reads it itself and takes the tile templates, zoom
  // range and scheme from there; only the tile size has to come from us
  protected async createSource(): Promise<RasterSourceSpecification> {
    return {
      type: 'raster',
      url: await this.source.getMapLibreSourceUrl(),
      tileSize: await this.tilejson.getTileSize(),
    };
  }

  // A record can reference the same tileset both ways, so keep the two sources distinct
  protected getSourceId(): string {
    return `${this.source.id}-tilejson`;
  }

  // Raster tilesets have their bounds in the TileJSON document
  async getBounds(): Promise<maplibregl.LngLatBoundsLike | undefined> {
    return await this.tilejson.getBounds();
  }

  // A TileJSON document can describe either kind of tileset, so its source isn't a RasterSource
  private get tilejson() {
    return this.source as unknown as TileJSONSource;
  }
}
