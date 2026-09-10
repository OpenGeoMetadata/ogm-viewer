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

  // The previewer handles this – we can't get bounds without knowing if we
  // need to reproject, and pulling that capability up to this layer would
  // be inefficient because all of a record's Resources are eagerly loaded.
  async getBounds() {
    return super.getBounds();
  }
}
