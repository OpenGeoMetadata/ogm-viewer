import type { RasterSourceSpecification, LayerSpecification } from 'maplibre-gl';

import MapPreviewer from './map';
import type RasterResource from '../resources/raster';

export type AddRasterSourceObject = RasterSourceSpecification & { id: string };

export default class RasterPreviewer extends MapPreviewer {
  declare protected resource: RasterResource;

  protected async createSources(): Promise<AddRasterSourceObject[]> {
    return [
      {
        id: this.getSourceId(),
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

  protected async createLayers(): Promise<LayerSpecification[]> {
    this.previewLayers.push({
      id: this.getSourceId(),
      title: this.resource.label(),
      defaultOpacity: this.style.opacity,
      styleLayers: [{ id: this.getSourceId(), type: 'raster' }],
    });

    return [
      {
        id: this.getSourceId(),
        type: 'raster',
        source: this.getSourceId(),
        layout: {
          visibility: 'visible',
        },
        paint: {
          'raster-opacity': this.style.opacity,
        },
      },
    ];
  }
}
