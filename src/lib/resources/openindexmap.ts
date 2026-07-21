import GeoJsonResource from './geojson';

export default class OpenIndexMapResource extends GeoJsonResource {
  // Distinguish the layer name from regular GeoJSON
  async getVectorLayers() {
    return ['indexmap'];
  }

  label() {
    return 'Index Map';
  }
}
