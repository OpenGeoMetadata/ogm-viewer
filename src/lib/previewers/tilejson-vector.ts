import TiledVectorPreviewer from './tiled-vector';
import type { AddVectorSourceObject } from './vector';

export default class TileJsonVectorPreviewer extends TiledVectorPreviewer {
  protected getSourceId(): string {
    return `${this.resource.id}-tilejson`;
  }

  // Handed the URL of the document, MapLibre reads it itself and takes the tile templates and
  // zoom range from there, so 'url' is all the source needs
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
