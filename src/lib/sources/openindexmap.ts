import GeoJSONSource from './geojson';

export default class OpenIndexMapSource extends GeoJSONSource {
  // Distinguish the layer name from regular GeoJSON
  async getVectorLayers() {
    return ['indexmap'];
  }
}
