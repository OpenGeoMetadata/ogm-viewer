import MapResource from './map';

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

  abstract getScheme(): 'xyz' | 'tms' | undefined;
}
