import type { MapGeoJSONFeature } from 'maplibre-gl';

import InspectableRasterPreviewer from './inspectable-raster';
import type { AddRasterSourceObject } from './raster';
import type EsriResource from '../resources/esri';
import { mercatorGeomToLngLat, type PixelWindow } from '../geometry';

export default abstract class EsriRasterPreviewer extends InspectableRasterPreviewer {
  declare protected resource: EsriResource;

  protected async createSources(): Promise<AddRasterSourceObject[]> {
    return [{ id: this.getSourceId(), type: 'raster', ...(await this.resource.getRasterSourceSpec()) }];
  }

  protected async checkInspectable(): Promise<boolean> {
    return await this.resource.canInspect();
  }

  async inspect(window: PixelWindow): Promise<MapGeoJSONFeature[]> {
    const features = await this.resource.inspect(window);

    return features.map(feature => ({
      ...feature,
      geometry: feature.geometry && mercatorGeomToLngLat(feature.geometry),
      source: this.getSourceId(),
    })) as unknown as MapGeoJSONFeature[];
  }
}
