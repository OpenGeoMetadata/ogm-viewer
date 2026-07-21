import geojsonExtent from '@mapbox/geojson-extent';

import VectorSource from './vector';
import { fetchOrThrow } from '../errors';

export default class GeoJSONSource extends VectorSource {
  // Data parsed from GeoJSON document
  private data: any;

  // Fetch and memoize data
  protected async getData() {
    if (!this.data) {
      const resp = await fetchOrThrow(this.url);
      this.data = await resp.json();
    }
    return this.data;
  }

  label() {
    return 'GeoJSON';
  }

  // GeoJSON is always a vector source
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

  // Used to zoom the map to the data once loaded
  async getBounds() {
    if (this.bounds) return this.bounds;

    const data = await this.getData();
    const bounds = geojsonExtent(data);
    return [
      [bounds[0], bounds[1]],
      [bounds[2], bounds[3]],
    ] as [[number, number], [number, number]];
  }
}
