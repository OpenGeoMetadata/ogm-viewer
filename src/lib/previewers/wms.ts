import type { MapGeoJSONFeature } from 'maplibre-gl';

import type WmsResource from '../resources/wms';
import type { AddRasterSourceObject } from './raster';
import InspectableRasterPreviewer from './inspectable-raster';
import { PreviewError } from '../errors';
import { mercatorGeomToLngLat, type PixelWindow } from '../geometry';

export default class WmsPreviewer extends InspectableRasterPreviewer {
  declare protected resource: WmsResource;

  // WMS sources have no scheme
  protected async createSources(): Promise<AddRasterSourceObject[]> {
    return [
      {
        id: this.getSourceId(),
        type: 'raster',
        tiles: [await this.resource.getMapLibreSourceUrl()],
        tileSize: this.resource.getTileSize(),
      },
    ];
  }

  getSourceId(): string {
    return `${this.resource.id}-wms`;
  }

  // Ask the server what it drew in the window, via a GetFeatureInfo request
  async inspect(window: PixelWindow): Promise<MapGeoJSONFeature[]> {
    const response = await this.resource.inspect(window);
    if (!response.ok) throw new PreviewError(`WMS GetFeatureInfo request failed with status ${response.status}`);

    const data = await response.json();
    if (!data || !data.features || !Array.isArray(data.features)) return [];

    // The server answers in the CRS the request asked for, but MapLibre sources are in degrees
    return data.features.map((feature: any) => ({
      ...feature,
      geometry: feature.geometry && mercatorGeomToLngLat(feature.geometry),
      source: this.getSourceId(),
    }));
  }
}
