import type { LngLatBoundsLike } from 'maplibre-gl';

import { rasterQuantity, type Quantity } from '../quantity';
import type { RequestTransform } from '../request';
import RasterResource from './raster';
import type { ResourceKind } from './resource';

export default class CogResource extends RasterResource {
  readonly kind: ResourceKind = 'cog';

  readonly fgdcUrl?: string;

  constructor(id: string, url: string, bounds?: LngLatBoundsLike, requestTransform?: RequestTransform, fgdcUrl?: string) {
    super(id, url, bounds, requestTransform);
    this.fgdcUrl = fgdcUrl;
  }

  label() {
    return 'Cloud Optimized GeoTIFF';
  }

  async getQuantity(): Promise<Quantity | undefined> {
    return await rasterQuantity(this.fgdcUrl, this.requestTransform);
  }

  getScheme() {
    return undefined;
  }

  async getBounds() {
    return super.getBounds();
  }
}
