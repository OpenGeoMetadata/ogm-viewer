import VectorPreviewer from './vector';
import type { FillLayerSpecification, LineLayerSpecification, CircleLayerSpecification, SymbolLayerSpecification } from 'maplibre-gl';

// A tileset (a PMTiles archive, a TileJSON tileset) can hold several named layers, so every style
// layer drawn from one has to name the layer it reads. Subclasses supply the source itself.
export default abstract class TiledVectorPreviewer extends VectorPreviewer {
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
