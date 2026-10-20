import type { LngLatBoundsLike } from 'maplibre-gl';

import GeoJsonResource from './geojson';
import type { ResourceKind } from './resource';
import { rasterQuantity, type Quantity } from '../quantity';
import type { RequestTransform } from '../request';

export default class OpenIndexMapResource extends GeoJsonResource {
  readonly kind: ResourceKind = 'openindexmap';

  // FGDC XML used to enhance metadata, if present
  readonly fgdcUrl?: string;

  constructor(id: string, url: string, bounds?: LngLatBoundsLike, requestTransform?: RequestTransform, fgdcUrl?: string) {
    super(id, url, bounds, requestTransform);
    this.fgdcUrl = fgdcUrl;
  }

  // Distinguish the layer name from regular GeoJSON
  async getVectorLayers() {
    return ['indexmap'];
  }

  label() {
    return 'Index Map';
  }

  // What the sheets' values measure, for a mosaic of them, if the record's FGDC says: an index map has
  // nowhere to say it, and a GeoTIFF needn't record it - 3DEP's record neither their datum nor their units
  async getQuantity(): Promise<Quantity | undefined> {
    return await rasterQuantity(this.fgdcUrl, this.requestTransform);
  }
}
