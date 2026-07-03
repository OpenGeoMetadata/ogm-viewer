import RasterSource from './raster';

export default class TmsSource extends RasterSource {
  label() {
    return 'Tiled Map Service (TMS)';
  }

  getScheme() {
    return 'tms' as const;
  }
}
