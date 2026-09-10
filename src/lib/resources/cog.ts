import RasterResource from './raster';
import type { ResourceKind } from './resource';

export default class CogResource extends RasterResource {
  readonly kind: ResourceKind = 'cog';

  label() {
    return 'Cloud Optimized GeoTIFF';
  }

  // COGs have no specific scheme identifier for MapLibre
  getScheme() {
    return undefined;
  }

  // TODO: is it possible to read COG metadata to get bounds?
  async getBounds() {
    return super.getBounds();
  }
}
