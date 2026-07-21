import MapResource from './map';

// Tiled raster data, accessed remotely
export default abstract class RasterResource extends MapResource {
  async isVector() {
    return false;
  }

  getTileSize(): number | undefined {
    return 256;
  }

  async getMapLibreSourceType() {
    return 'raster' as const;
  }

  // Protocol identifier for MapLibre
  abstract getScheme(): 'xyz' | 'tms' | undefined;
}
