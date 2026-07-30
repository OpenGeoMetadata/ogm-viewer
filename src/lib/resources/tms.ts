import RasterResource from './raster';
import type { ResourceKind } from './resource';

export default class TmsResource extends RasterResource {
  readonly kind: ResourceKind = 'tms';

  label() {
    return 'Tiled Map Service (TMS)';
  }

  getScheme() {
    return 'tms' as const;
  }
}
