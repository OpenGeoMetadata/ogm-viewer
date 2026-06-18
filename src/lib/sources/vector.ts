import { LngLatLike, SourceSpecification } from 'maplibre-gl';

import Source from './source';

// A source of vector data, accessed remotely
export default abstract class VectorSource extends Source {
  async isVector() {
    return true;
  }

  async getType(): Promise<SourceSpecification['type']> {
    return 'vector' as const;
  }

  // Used to zoom the map to the data once loaded
  abstract getBounds(): Promise<[LngLatLike, LngLatLike]>;

  // List of layer IDs used to generate MapLibre style layers
  abstract getVectorLayers(): Promise<string[]>;

  // Passed to MapLibre to determine how to decode vector tiles
  abstract getVectorEncoding(): Promise<'mvt' | 'mlt' | undefined>;
}
