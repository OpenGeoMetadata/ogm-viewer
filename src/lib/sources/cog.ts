import RasterSource from './raster';

export default class CogSource extends RasterSource {
  // COGs have no specific scheme identifier for MapLibre
  getScheme() {
    return undefined;
  }

  // We don't need to set an explicit tile size for COGs
  getTileSize() {
    return undefined;
  }
}
