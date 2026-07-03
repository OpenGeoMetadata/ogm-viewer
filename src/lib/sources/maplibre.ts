import type { SourceSpecification } from 'maplibre-gl';

import Source from './source';

// A source of mapped vector or raster data, accessed remotely
export default abstract class MapLibreSource extends Source {
  // URL used to generate a MapLibre source when adding to map
  getMapLibreSourceUrl(): string {
    return this.url;
  }

  // Async because it may read metadata from remote source
  abstract isVector(): Promise<boolean>;

  // MapLibre source type for this source
  abstract getMapLibreSourceType(): Promise<SourceSpecification['type']>;
}
