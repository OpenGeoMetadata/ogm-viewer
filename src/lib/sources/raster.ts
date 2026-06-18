import Source from './source';

// Tiled raster data, accessed remotely
export default abstract class RasterSource extends Source {
  async isVector() {
    return false;
  }

  getTileSize(): number | undefined {
    return 256;
  }

  async getType() {
    return 'raster' as const;
  }

  // Protocol identifier for MapLibre
  abstract getScheme(): 'xyz' | 'tms' | undefined;
}
