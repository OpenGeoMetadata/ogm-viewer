import type { LngLatBoundsLike } from 'maplibre-gl';

import { rasterQuantity, type Quantity } from '../quantity';
import type { RequestTransform } from '../request';
import RasterResource from './raster';
import type { ResourceKind } from './resource';

export default class CogResource extends RasterResource {
  readonly kind: ResourceKind = 'cog';

  // URL to FGDC metadata that describes this COG
  readonly fgdcUrl?: string;

  constructor(id: string, url: string, bounds?: LngLatBoundsLike, requestTransform?: RequestTransform, fgdcUrl?: string) {
    super(id, url, bounds, requestTransform);
    this.fgdcUrl = fgdcUrl;
  }

  label() {
    return 'Cloud Optimized GeoTIFF';
  }

  // What the COG's values measure, if it can be read from the FGDC metadata
  async getQuantity(): Promise<Quantity | undefined> {
    return await rasterQuantity(this.fgdcUrl, this.requestTransform);
  }

  // COGs have no specific scheme identifier for MapLibre
  getScheme() {
    return undefined;
  }

  // The previewer handles this – we can't get bounds without knowing if we
  // need to reproject, and pulling that capability up to this layer would
  // be inefficient because all of a record's Resources are eagerly loaded.
  async getBounds() {
    return super.getBounds();
  }
}
