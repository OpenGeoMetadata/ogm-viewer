import TiledVectorPreviewer from './tiled-vector';
import type { VectorSourceSpecification } from 'maplibre-gl';

export default class PMTilesVectorPreviewer extends TiledVectorPreviewer {
  // Only one source for PMTiles
  protected async createSources(): Promise<VectorSourceSpecification[]> {
    return [
      {
        type: 'vector',
        url: this.resource.getMapLibreSourceUrl(),
        encoding: await this.resource.getVectorEncoding(),
      },
    ];
  }
}
