import EsriMapServerResource from './esri-map-server';
import type { ResourceKind } from './resource';

export default class EsriDynamicMapLayerResource extends EsriMapServerResource {
  readonly kind: ResourceKind = 'esri-dynamic-map-layer';

  label() {
    return 'ArcGIS Dynamic Map Layer';
  }

  getMapLibreSourceUrl() {
    return this.exportUrl('export', this.layerId ? { layers: `show:${this.layerId}` } : {});
  }
}
