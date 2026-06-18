import type { RasterSourceSpecification, RasterLayerSpecification } from 'maplibre-gl';

import MapLibrePreviewer from './maplibre';
import type RasterSource from '../sources/raster';

export default class RasterPreviewer extends MapLibrePreviewer {
  declare protected source: RasterSource;

  protected async createSource(): Promise<RasterSourceSpecification> {
    return {
      type: 'raster',
      tiles: [await this.source.getSourceUrl()],
      scheme: this.source.getScheme(),
      tileSize: this.source.getTileSize(),
    };
  }

  protected getSourceId(): string {
    return `${this.source.id}-${this.source.getScheme()}`;
  }

  // Rasters only have one layer
  protected async createLayers(): Promise<RasterLayerSpecification[]> {
    return [
      {
        id: this.getSourceId(),
        type: 'raster',
        source: this.getSourceId(),
        paint: {
          'raster-opacity': this.opacity,
        },
      },
    ];
  }

  async getBounds(): Promise<maplibregl.LngLatBoundsLike | undefined> {
    return undefined;
  }

  async setOpacity(opacity: number) {
    this.opacity = opacity;
    if (this.layerIds.length > 0) {
      await this.map.setPaintProperty(this.layerIds[0], 'raster-opacity', this.opacity);
    }
  }
}
