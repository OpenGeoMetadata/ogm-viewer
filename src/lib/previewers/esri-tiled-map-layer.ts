import EsriRasterPreviewer from './esri-raster';

export default class EsriTiledMapLayerPreviewer extends EsriRasterPreviewer {
  // A record can point at the same ArcGIS service more than one way, so keep the sources distinct
  protected getSourceId(): string {
    return `${this.resource.id}-esri-tiled-map-layer`;
  }
}
