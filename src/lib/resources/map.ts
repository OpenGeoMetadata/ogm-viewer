import type { SourceSpecification } from 'maplibre-gl';

import Resource from './resource';

export default abstract class MapResource extends Resource {
  getMapLibreSourceUrl(): string {
    return this.url;
  }

  abstract isVector(): Promise<boolean>;

  abstract getMapLibreSourceType(): Promise<SourceSpecification['type']>;
}
