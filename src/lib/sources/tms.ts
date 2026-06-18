import RasterSource from './raster';

export default class TmsSource extends RasterSource {
  getScheme() {
    return 'tms' as const;
  }
}
