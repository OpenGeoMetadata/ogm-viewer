import type { RasterSourceSpecification, LayerSpecification } from 'maplibre-gl';

import MapPreviewer from './map';
import type RasterResource from '../resources/raster';

// MapLibre doesn't bundle the id with the source, but we need to
export type AddRasterSourceObject = RasterSourceSpecification & { id: string };

export default class RasterPreviewer extends MapPreviewer {
  declare protected resource: RasterResource;

  // By default, rasters only have one source
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

  // Rasters only have one layer of their own; subclasses may add companion layers after it.
  // `visibility` is declared even though it's MapLibre's default, so that re-applying the user's
  // state is a no-op: MapLibre compares against the value the layer declared, and an undefined one
  // never matches 'visible', which would send the source back to be reloaded on every preview.
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
