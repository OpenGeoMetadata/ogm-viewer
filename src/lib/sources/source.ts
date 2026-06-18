import type { SourceSpecification } from 'maplibre-gl';

// A source of vector or raster data, accessed remotely
export default abstract class Source {
  // URL to the remote data source
  protected url: string;

  // Unique ID for this source, used in MapLibre style generation
  id: string;

  // Store the source URL
  constructor(id: string, url: string) {
    this.id = id;
    this.url = url;
  }

  // Check that the URL is valid and accessible
  async test() {
    await fetch(this.url, { method: 'HEAD' });
  }

  // URL used to generate a MapLibre source when adding to map
  getSourceUrl(): string {
    return this.url;
  }

  // Async because it may read metadata from remote source
  abstract isVector(): Promise<boolean>;

  // MapLibre source type for this source
  abstract getType(): Promise<SourceSpecification['type']>;
}
