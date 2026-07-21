import RasterResource from './raster';

export default class TmsResource extends RasterResource {
  label() {
    return 'Tiled Map Service (TMS)';
  }

  getScheme() {
    return 'tms' as const;
  }
}
