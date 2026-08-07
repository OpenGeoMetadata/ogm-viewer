import geojsonExtent from '@mapbox/geojson-extent';
import type { LngLatBoundsLike } from 'maplibre-gl';

import VectorResource from './vector';
import type { ResourceKind } from './resource';
import { fetchOrThrow } from '../errors';
import { resolveRequest } from '../request';

export default class GeoJsonResource extends VectorResource {
  readonly kind: ResourceKind = 'geojson';

  // Data parsed from GeoJSON document
  private data: any;

  // Fetch and memoize data
  protected async getData() {
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

  // GeoJSON is always a vector resource
  async isVector() {
    return true;
  }

  // GeoJSON is always encoded as JSON
  async getVectorEncoding() {
    return undefined;
  }

  // GeoJSON has a special source type
  async getMapLibreSourceType() {
    return 'geojson' as const;
  }

  // Only one layer in a GeoJSON document
  async getVectorLayers() {
    return ['geojson'];
  }

  // Used to zoom the map to the data once loaded. Subclasses that read from a service may not be
  // able to work out bounds at all, so the camera can be left where it is.
  async getBounds(): Promise<LngLatBoundsLike | undefined> {
    if (this.bounds) return this.bounds;

    const data = await this.getData();
    const bounds = geojsonExtent(data);
    return [
      [bounds[0], bounds[1]],
      [bounds[2], bounds[3]],
    ] as [[number, number], [number, number]];
  }
}
