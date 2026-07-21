import type { RasterSourceSpecification, LayerSpecification } from 'maplibre-gl';

import MapPreviewer from './map';
import type RasterResource from '../resources/raster';

export default class RasterPreviewer extends MapPreviewer {
  declare protected resource: RasterResource;

  // By default, rasters only have one source
  protected async createSources(): Promise<RasterSourceSpecification[]> {
    return [
      {
        type: 'raster',
        tiles: [await this.resource.getMapLibreSourceUrl()],
        scheme: this.resource.getScheme(),
        tileSize: this.resource.getTileSize(),
      },
    ];
  }

  protected getSourceId(): string {
    return `${this.resource.id}-${this.resource.getScheme()}`;
  }

  // Rasters only have one layer of their own; subclasses may add companion layers after it
  protected async createLayers(): Promise<LayerSpecification[]> {
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
