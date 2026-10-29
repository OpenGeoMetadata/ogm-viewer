import EsriRasterPreviewer from './esri-raster';

export default class EsriDynamicMapLayerPreviewer extends EsriRasterPreviewer {
  protected getSourceId(): string {
    return `${this.resource.id}-esri-dynamic-map-layer`;
  }
}
