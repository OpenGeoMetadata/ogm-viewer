import TiledVectorPreviewer from './tiled-vector';
import type { VectorSourceSpecification } from 'maplibre-gl';

export default class PMTilesVectorPreviewer extends TiledVectorPreviewer {
  protected async createSource(): Promise<VectorSourceSpecification> {
    return {
      type: 'vector',
      url: this.source.getMapLibreSourceUrl(),
      encoding: await this.source.getVectorEncoding(),
    };
  }
}
