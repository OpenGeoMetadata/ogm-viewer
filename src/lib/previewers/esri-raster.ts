import type { MapGeoJSONFeature } from 'maplibre-gl';

import InspectableRasterPreviewer from './inspectable-raster';
import type { AddRasterSourceObject } from './raster';
import type EsriResource from '../resources/esri';
import { mercatorGeomToLngLat, type PixelWindow } from '../geometry';

// Raster tiles drawn by an ArcGIS service. How the tiles are fetched - a rendering request per
// tile, or a read out of a cache - is the resource's business, so the source is assembled from
// whatever it says it needs; subclasses only name themselves.
export default abstract class EsriRasterPreviewer extends InspectableRasterPreviewer {
  declare protected resource: EsriResource;

  protected async createSources(): Promise<AddRasterSourceObject[]> {
    return [{ id: this.getSourceId(), type: 'raster', ...(await this.resource.getRasterSourceSpec()) }];
  }

  // Only some ArcGIS services will say what they drew at a point
  protected async checkInspectable(): Promise<boolean> {
    return await this.resource.canInspect();
  }

  // Ask the service what it drew in the window, via an identify request
  async inspect(window: PixelWindow): Promise<MapGeoJSONFeature[]> {
    const features = await this.resource.inspect(window);

    // The service answers in the CRS the request asked for, but MapLibre sources are in degrees
    return features.map(feature => ({
      ...feature,
      geometry: feature.geometry && mercatorGeomToLngLat(feature.geometry),
      source: this.getSourceId(),
    })) as unknown as MapGeoJSONFeature[];
  }
}
