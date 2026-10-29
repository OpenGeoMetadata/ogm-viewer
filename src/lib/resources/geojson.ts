import geojsonExtent from '@mapbox/geojson-extent';
import type { LngLatBoundsLike } from 'maplibre-gl';

import VectorResource from './vector';
import type { ResourceKind } from './resource';
import { fetchOrThrow } from '../errors';
import { resolveRequest } from '../request';

export default class GeoJsonResource extends VectorResource {
  readonly kind: ResourceKind = 'geojson';

  private data: any;

  async getData() {
    if (!this.data) {
      const { url, init } = resolveRequest(this.url, 'metadata', this.requestTransform);
      const resp = await fetchOrThrow(url, init);
      this.data = await resp.json();
    }
    return this.data;
  }

  label() {
    return 'GeoJSON';
  }

  async isVector() {
    return true;
  }

  async getVectorEncoding() {
    return undefined;
  }

  async getMapLibreSourceType() {
    return 'geojson' as const;
  }

  async getVectorLayers() {
    return ['geojson'];
  }

  async getReportedBounds(): Promise<LngLatBoundsLike | undefined> {
    const data = await this.getData();
    const bounds = geojsonExtent(data);
    return [
      [bounds[0], bounds[1]],
      [bounds[2], bounds[3]],
    ] as [[number, number], [number, number]];
  }
}
