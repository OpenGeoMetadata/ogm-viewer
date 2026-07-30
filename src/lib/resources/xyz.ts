import RasterResource from './raster';
import type { ResourceKind } from './resource';

export default class XyzResource extends RasterResource {
  readonly kind: ResourceKind = 'xyz';

  label() {
    return 'XYZ Tile Service';
  }

  getScheme() {
    return 'xyz' as const;
  }
}
