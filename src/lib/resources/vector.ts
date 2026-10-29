import { SourceSpecification } from 'maplibre-gl';

import MapResource from './map';

export default abstract class VectorResource extends MapResource {
  async isVector() {
    return true;
  }

  async getMapLibreSourceType(): Promise<SourceSpecification['type']> {
    return 'vector' as const;
  }

  abstract getVectorLayers(): Promise<string[]>;

  abstract getVectorEncoding(): Promise<'mvt' | 'mlt' | undefined>;
}
