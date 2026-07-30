import GeoJsonResource from './geojson';
import type { ResourceKind } from './resource';

export default class OpenIndexMapResource extends GeoJsonResource {
  readonly kind: ResourceKind = 'openindexmap';

  // Distinguish the layer name from regular GeoJSON
  async getVectorLayers() {
    return ['indexmap'];
  }

  label() {
    return 'Index Map';
  }
}
