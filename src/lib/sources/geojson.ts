import geojsonExtent from '@mapbox/geojson-extent';

import VectorSource from './vector';

export default class GeoJSONSource extends VectorSource {
  // Data parsed from GeoJSON document
  private data: any;

  // Fetch and memoize data
  protected async getData() {
    if (!this.data) {
      const resp = await fetch(this.url);
      this.data = await resp.json();
    }
    return this.data;
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
  async getType() {
    return 'geojson' as const;
  }

  // Only one layer in a GeoJSON document
  async getVectorLayers() {
    return ['geojson'];
  }

  async getBounds() {
    const data = await this.getData();
    const bounds = geojsonExtent(data);
    return [
      [bounds[0], bounds[1]],
      [bounds[2], bounds[3]],
    ] as [[number, number], [number, number]];
  }
}
