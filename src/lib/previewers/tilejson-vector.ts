import TiledVectorPreviewer from './tiled-vector';
import type { AddVectorSourceObject } from './vector';

export default class TileJsonVectorPreviewer extends TiledVectorPreviewer {
  protected readonly featuresMayLackIds = true;

  protected getSourceId(): string {
    return `${this.resource.id}-tilejson`;
  }

  protected async createSources(): Promise<AddVectorSourceObject[]> {
    return [
      {
        id: this.getSourceId(),
        type: 'vector',
        url: this.resource.getMapLibreSourceUrl(),
        encoding: await this.resource.getVectorEncoding(),
      },
    ];
  }
}
