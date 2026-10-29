import EsriRasterPreviewer from './esri-raster';

export default class EsriTiledMapLayerPreviewer extends EsriRasterPreviewer {
  protected getSourceId(): string {
    return `${this.resource.id}-esri-tiled-map-layer`;
  }
}
