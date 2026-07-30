import type { LngLatBoundsLike } from 'maplibre-gl';

// Names the kind of data a resource holds. Previewers are chosen by matching on this string rather
// than with `instanceof`: a class test only holds when both sides came from the same copy of the
// module, and it forces every subclass to be tested ahead of its parent to be reachable at all.
export type ResourceKind =
  | 'cog'
  | 'esri-dynamic-map-layer'
  | 'esri-feature-layer'
  | 'esri-image-map-layer'
  | 'esri-tiled-map-layer'
  | 'geojson'
  | 'iiif-image'
  | 'iiif-manifest'
  | 'openindexmap'
  | 'pmtiles'
  | 'tilejson'
  | 'tms'
  | 'wms'
  | 'wmts'
  | 'xyz';

// A source of previewable data at a URL
export default abstract class Resource {
  // Which kind of data this is; see ResourceKind
  abstract readonly kind: ResourceKind;

  // URL to the remote data source
  url: string;

  // Explicitly provided bounds for the source, if any
  protected bounds: LngLatBoundsLike | undefined;

  // Unique ID for this resource
  id: string;

  // Store the source URL
  constructor(id: string, url: string, bounds?: LngLatBoundsLike) {
    this.id = id;
    this.url = url;
    this.bounds = bounds;
  }

  // Used to label the tabs for switching between previews, e.g.
  label(): string {
    return this.constructor.name;
  }

  // Check that the URL is valid and accessible
  async test() {
    try {
      const response = await fetch(this.url, {
        method: 'HEAD',
        signal: AbortSignal.timeout(8000),
      });
      return response.ok;
    } catch (error) {
      console.error(`Error checking source URL ${this.url}:`, error);
      return false;
    }
  }

  // Async because subclasses may do operations to calculate it
  async getBounds(): Promise<LngLatBoundsLike | undefined> {
    if (this.bounds) return this.bounds;
    return undefined;
  }
}
