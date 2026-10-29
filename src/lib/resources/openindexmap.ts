import type { LngLatBoundsLike } from 'maplibre-gl';

import GeoJsonResource from './geojson';
import type { ResourceKind } from './resource';
import { rasterQuantity, type Quantity } from '../quantity';
import type { RequestTransform } from '../request';

export default class OpenIndexMapResource extends GeoJsonResource {
  readonly kind: ResourceKind = 'openindexmap';

  readonly fgdcUrl?: string;

  constructor(id: string, url: string, bounds?: LngLatBoundsLike, requestTransform?: RequestTransform, fgdcUrl?: string) {
    super(id, url, bounds, requestTransform);
    this.fgdcUrl = fgdcUrl;
  }

  async getVectorLayers() {
    return ['indexmap'];
  }

  label() {
    return 'Index Map';
  }

  async getQuantity(): Promise<Quantity | undefined> {
    return await rasterQuantity(this.fgdcUrl, this.requestTransform);
  }
}
