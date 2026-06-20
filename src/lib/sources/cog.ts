import RasterSource from './raster';

export default class CogSource extends RasterSource {
  // Appends the cog:// protocol; must be registered first to work
  getSourceUrl() {
    return `cog://${this.url}`;
  }

  // COGs have no specific scheme identifier for MapLibre
  getScheme() {
    return undefined;
  }

  // TODO: is it possible to read COG metadata to get bounds?
  async getBounds() {
    return undefined;
  }
}
