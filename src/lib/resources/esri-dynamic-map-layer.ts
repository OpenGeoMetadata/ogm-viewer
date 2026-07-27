import EsriMapServerResource from './esri-map-server';

// A MapServer that draws the map on demand rather than serving tiles cut in advance. The service
// re-renders at whatever extent MapLibre asks for, so a preview always shows the current data.
export default class EsriDynamicMapLayerResource extends EsriMapServerResource {
  label() {
    return 'ArcGIS Dynamic Map Layer';
  }

  // A reference that names a layer draws just that one; one that names the service draws the
  // layers the service has set to be visible by default, as ArcGIS's own viewers do.
  getMapLibreSourceUrl() {
    return this.exportUrl('export', this.layerId ? { layers: `show:${this.layerId}` } : {});
  }
}
