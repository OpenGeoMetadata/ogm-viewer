import type { LngLatBoundsLike } from 'maplibre-gl';

// A source of previewable data at a URL
export default abstract class Source {
  // URL to the remote data source
  protected url: string;

  // Explicitly provided bounds for the source, if any
  protected bounds: LngLatBoundsLike | undefined;

  // Unique ID for this source
  id: string;

  // Store the source URL
  constructor(id: string, url: string, bounds?: LngLatBoundsLike) {
    this.id = id;
    this.url = url;
    this.bounds = bounds;
  }

  // Used to label the tabs for switching between sources, e.g.
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
