import { SourceSpecification } from 'maplibre-gl';

import MapLibreSource from './maplibre';

// A source of vector data, accessed remotely
export default abstract class VectorSource extends MapLibreSource {
  async isVector() {
    return true;
  }

  async getMapLibreSourceType(): Promise<SourceSpecification['type']> {
    return 'vector' as const;
  }

  // List of layer IDs used to generate MapLibre style layers
  abstract getVectorLayers(): Promise<string[]>;

  // Passed to MapLibre to determine how to decode vector tiles
  abstract getVectorEncoding(): Promise<'mvt' | 'mlt' | undefined>;
}
