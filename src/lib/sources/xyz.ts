import RasterSource from './raster';

export default class XyzSource extends RasterSource {
  label() {
    return 'XYZ Tile Service';
  }

  getScheme() {
    return 'xyz' as const;
  }
}
