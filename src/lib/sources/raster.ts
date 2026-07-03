import MapLibreSource from './maplibre';

// Tiled raster data, accessed remotely
export default abstract class RasterSource extends MapLibreSource {
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
