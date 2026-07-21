import RasterResource from './raster';

export default class XyzResource extends RasterResource {
  label() {
    return 'XYZ Tile Service';
  }

  getScheme() {
    return 'xyz' as const;
  }
}
