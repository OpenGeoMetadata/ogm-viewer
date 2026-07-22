import TiledVectorPreviewer from './tiled-vector';
import type { AddVectorSourceObject } from './vector';

export default class PMTilesVectorPreviewer extends TiledVectorPreviewer {
  // Only one source for PMTiles
  protected async createSources(): Promise<AddVectorSourceObject[]> {
    return [
      {
        id: this.resource.id,
        type: 'vector',
        url: this.resource.getMapLibreSourceUrl(),
        encoding: await this.resource.getVectorEncoding(),
      },
    ];
  }
}
