import RasterSource from './raster';

export default class XyzSource extends RasterSource {
  getScheme() {
    return 'xyz' as const;
  }
}
