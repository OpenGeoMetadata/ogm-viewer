import TiledVectorPreviewer from './tiled-vector';
import type { VectorSourceSpecification } from 'maplibre-gl';

export default class TileJSONVectorPreviewer extends TiledVectorPreviewer {
  // Handed the URL of the document, MapLibre reads it itself and takes the tile templates and
  // zoom range from there, so 'url' is all the source needs
  protected async createSource(): Promise<VectorSourceSpecification> {
    return {
      type: 'vector',
      url: this.source.getMapLibreSourceUrl(),
      encoding: await this.source.getVectorEncoding(),
    };
  }

  // A record can reference the same tileset both ways, so keep the two sources distinct
  protected getSourceId(): string {
    return `${this.source.id}-tilejson`;
  }
}
