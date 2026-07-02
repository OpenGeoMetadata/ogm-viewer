import VectorPreviewer from './vector';
import type { VectorSourceSpecification, FillLayerSpecification, LineLayerSpecification, CircleLayerSpecification, SymbolLayerSpecification } from 'maplibre-gl';

export default class PMTilesVectorPreviewer extends VectorPreviewer {
  protected async createSource(): Promise<VectorSourceSpecification> {
    return {
      type: 'vector',
      url: this.source.getSourceUrl(),
      encoding: await this.source.getVectorEncoding(),
    };
  }

  /* Add 'source-layer' property because PMTiles can contain multiple layers */

  protected createPolygonLayer(layerId: string): FillLayerSpecification {
    return {
      ...super.createPolygonLayer(layerId),
      'source-layer': layerId,
    };
  }

  protected createPolygonOutlineLayer(layerId: string): LineLayerSpecification {
    return {
      ...super.createPolygonOutlineLayer(layerId),
      'source-layer': layerId,
    };
  }

  protected createLineLayer(layerId: string): LineLayerSpecification {
    return {
      ...super.createLineLayer(layerId),
      'source-layer': layerId,
    };
  }

  protected createPointLayer(layerId: string): CircleLayerSpecification {
    return {
      ...super.createPointLayer(layerId),
      'source-layer': layerId,
    };
  }

  protected createPolygonLabelLayer(layerId: string): SymbolLayerSpecification {
    return {
      ...super.createPolygonLabelLayer(layerId),
      'source-layer': layerId,
    };
  }

  protected createLineLabelLayer(layerId: string): SymbolLayerSpecification {
    return {
      ...super.createLineLabelLayer(layerId),
      'source-layer': layerId,
    };
  }

  protected createPointLabelLayer(layerId: string): SymbolLayerSpecification {
    return {
      ...super.createPointLabelLayer(layerId),
      'source-layer': layerId,
    };
  }
}
