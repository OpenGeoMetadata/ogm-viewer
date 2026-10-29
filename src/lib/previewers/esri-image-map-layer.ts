import EsriRasterPreviewer from './esri-raster';

export default class EsriImageMapLayerPreviewer extends EsriRasterPreviewer {
  protected getSourceId(): string {
    return `${this.resource.id}-esri-image-map-layer`;
  }
}
