import type { LngLatBoundsLike } from 'maplibre-gl';

import { resolveRequest, type RequestTransform } from '../request';

// Use a stable kind string because instanceof fails across separate copies of the library.
export type ResourceKind =
  | 'cog'
  | 'esri-dynamic-map-layer'
  | 'esri-feature-layer'
  | 'esri-image-map-layer'
  | 'esri-tiled-map-layer'
  | 'geojson'
  | 'iiif-image'
  | 'iiif-manifest'
  | 'location'
  | 'openindexmap'
  | 'pmtiles'
  | 'tilejson'
  | 'tms'
  | 'wms'
  | 'wmts'
  | 'xyz';

export default abstract class Resource {
  abstract readonly kind: ResourceKind;

  url: string;

  protected bounds: LngLatBoundsLike | undefined;

  id: string;

  readonly requestTransform?: RequestTransform;

  constructor(id: string, url: string, bounds?: LngLatBoundsLike, requestTransform?: RequestTransform) {
    this.id = id;
    this.url = url;
    this.bounds = bounds;
    this.requestTransform = requestTransform;
  }

  label(): string {
    return this.constructor.name;
  }

  async test() {
    try {
      const { url, init } = resolveRequest(this.url, 'metadata', this.requestTransform);
      const response = await fetch(url, {
        ...init,
        method: 'HEAD',
        signal: AbortSignal.timeout(8000),
      });
      return response.ok;
    } catch (error) {
      console.error(`Error checking source URL ${this.url}:`, error);
      return false;
    }
  }

  get declaredBounds(): LngLatBoundsLike | undefined {
    return this.bounds;
  }

  async getBounds(): Promise<LngLatBoundsLike | undefined> {
    return this.bounds ?? (await this.getReportedBounds());
  }

  async getReportedBounds(): Promise<LngLatBoundsLike | undefined> {
    return undefined;
  }
}
