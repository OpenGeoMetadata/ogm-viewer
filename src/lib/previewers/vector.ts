import MapPreviewer from './map';
import type {
  ExpressionSpecification,
  FillLayerSpecification,
  LineLayerSpecification,
  CircleLayerSpecification,
  SymbolLayerSpecification,
  LayerSpecification,
  VectorSourceSpecification,
} from 'maplibre-gl';

import type { PreviewStyleLayer } from '../layers';
import type VectorResource from '../resources/vector';

// MapLibre doesn't bundle the id with the source, but we need to
export type AddVectorSourceObject = VectorSourceSpecification & { id: string };

export default abstract class VectorPreviewer extends MapPreviewer {
  declare protected resource: VectorResource;

  protected getSourceId(): string {
    return this.resource.id;
  }

  async getBounds() {
    return await this.resource.getBounds();
  }

  protected async createLayers(): Promise<LayerSpecification[]> {
    const layerIds = await this.resource.getVectorLayers();
    return layerIds.flatMap(layerId => {
      const layers = [
        this.createPolygonLayer(layerId),
        this.createPolygonOutlineLayer(layerId),
        this.createLineLayer(layerId),
        this.createPointLayer(layerId),
        this.createPolygonLabelLayer(layerId),
        this.createLineLabelLayer(layerId),
        this.createPointLabelLayer(layerId),
      ];

      // Seven style layers, one row: geometry and its labels are how a vector layer is drawn, not
      // seven things a reader chose to put on the map
      this.previewLayers.push({
        id: `${this.getSourceId()}-${layerId}`,
        title: this.previewLayerTitle(layerId),
        defaultOpacity: this.style.opacity,
        styleLayers: layers.map(layer => ({ id: layer.id, type: layer.type }) as PreviewStyleLayer),
      });

      return layers;
    });
  }

  // What to call this layer in the control. A single-layer source names its one layer for our own
  // benefit ('geojson', 'indexmap'), which would tell a reader nothing, so the resource's own
  // label is the better name; a tileset that names its layers itself overrides this.
  protected previewLayerTitle(_layerId: string): string {
    return this.resource.label();
  }

  // A fill doesn't carry its opacity as a number: a selected feature is drawn at a different opacity
  // from the rest, and that is an expression over feature-state. The layer's opacity has to be
  // written into the unselected branch alone - a flat number over the whole expression would take
  // the selection highlight with it, which is the one thing a reader adjusting opacity still needs
  // to see. So the selected feature stays solid at any opacity: someone who faded a layer down to
  // read the basemap through it has all the more reason to want the feature they clicked to stand out.
  protected selectedOpacity(opacity: number): ExpressionSpecification {
    return ['case', ['boolean', ['feature-state', 'selected'], false], 1, opacity];
  }

  // Fills and circles keep their case expression; everything else takes the plain number
  protected applyOpacity(styleLayer: PreviewStyleLayer, opacity: number) {
    if (styleLayer.type === 'fill') {
      this.map.setPaintProperty(styleLayer.id, 'fill-opacity', this.selectedOpacity(opacity));
    } else if (styleLayer.type === 'circle') {
      this.map.setPaintProperty(styleLayer.id, 'circle-opacity', this.selectedOpacity(opacity));
      // The ring is a flat colour, so it fades on its own or it stays solid over a faded fill
      this.map.setPaintProperty(styleLayer.id, 'circle-stroke-opacity', opacity);
    } else {
      super.applyOpacity(styleLayer, opacity);
    }
  }

  // Create a styled layer that will be used for polygon geometry
  protected createPolygonLayer(layerId: string): FillLayerSpecification {
    return {
      id: `${this.getSourceId()}-${layerId}-polygons`,
      type: 'fill' as const,
      source: this.getSourceId(),
      layout: {
        visibility: 'visible' as const,
      },
      paint: {
        'fill-color': [
          'case',
          ['boolean', ['feature-state', 'selected'], false],
          this.style.fillSelectedColor,
          ['boolean', ['feature-state', 'hover'], false],
          this.style.fillHighlightColor,
          this.style.fillColor,
        ] as const,
        'fill-opacity': this.selectedOpacity(this.style.opacity),
      },
      filter: ['==', ['geometry-type'], 'Polygon'] as const,
    };
  }

  // Create a styled layer that will be used to outline polygon geometry
  protected createPolygonOutlineLayer(layerId: string): LineLayerSpecification {
    return {
      id: `${this.getSourceId()}-${layerId}-polygon-outlines`,
      type: 'line' as const,
      source: this.getSourceId(),
      layout: {
        visibility: 'visible' as const,
      },
      paint: {
        'line-color': [
          'case',
          ['boolean', ['feature-state', 'selected'], false],
          this.style.strokeSelectedColor,
          ['boolean', ['feature-state', 'hover'], false],
          this.style.strokeHighlightColor,
          this.style.strokeColor,
        ] as const,
        'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 2, 1] as const,
        'line-opacity': this.style.opacity,
      },
      filter: ['==', ['geometry-type'], 'Polygon'] as const,
    };
  }

  // Create a styled layer that will be used for line geometry
  protected createLineLayer(layerId: string): LineLayerSpecification {
    return {
      id: `${this.getSourceId()}-${layerId}-lines`,
      type: 'line' as const,
      source: this.getSourceId(),
      layout: {
        visibility: 'visible' as const,
      },
      paint: {
        'line-color': [
          'case',
          ['boolean', ['feature-state', 'selected'], false],
          this.style.strokeSelectedColor,
          ['boolean', ['feature-state', 'hover'], false],
          this.style.strokeHighlightColor,
          this.style.strokeColor,
        ] as const,
        'line-width': 4,
        'line-opacity': this.style.opacity,
      },
      filter: ['==', ['geometry-type'], 'LineString'] as const,
    };
  }

  // Create a styled layer that will be used for point geometry
  protected createPointLayer(layerId: string): CircleLayerSpecification {
    return {
      id: `${this.getSourceId()}-${layerId}-points`,
      type: 'circle' as const,
      source: this.getSourceId(),
      layout: {
        visibility: 'visible' as const,
      },
      paint: {
        'circle-color': [
          'case',
          ['boolean', ['feature-state', 'selected'], false],
          this.style.fillSelectedColor,
          ['boolean', ['feature-state', 'hover'], false],
          this.style.fillHighlightColor,
          this.style.fillColor,
        ] as const,
        'circle-stroke-color': [
          'case',
          ['boolean', ['feature-state', 'selected'], false],
          this.style.strokeSelectedColor,
          ['boolean', ['feature-state', 'hover'], false],
          this.style.strokeHighlightColor,
          this.style.strokeColor,
        ] as const,
        'circle-stroke-width': ['case', ['boolean', ['feature-state', 'selected'], false], 2, 1] as const,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 2, 12, 4] as const,
        'circle-opacity': this.selectedOpacity(this.style.opacity),
        'circle-stroke-opacity': this.style.opacity,
      },
      filter: ['==', ['geometry-type'], 'Point'] as const,
    };
  }

  // Create a styled layer that will be used for polygon labels
  protected createPolygonLabelLayer(layerId: string): SymbolLayerSpecification {
    return {
      id: `${this.getSourceId()}-${layerId}-polygon-labels`,
      type: 'symbol' as const,
      source: this.getSourceId(),
      layout: {
        'visibility': 'visible' as const,
        'text-field': ['get', 'id'] as const,
        'text-font': [this.style.textFont],
        'text-max-angle': 85,
        'text-size': this.style.textSize,
        'text-offset': [0, 1],
        'text-anchor': 'bottom',
        'text-rotation-alignment': 'map',
        'text-keep-upright': true,
        'symbol-placement': 'line',
        'symbol-spacing': 250,
      },
      paint: {
        'text-color': this.style.textColor,
        'text-halo-color': 'white',
        'text-halo-width': 1,
        'text-opacity': this.style.opacity,
      },
      filter: ['==', ['geometry-type'], 'Polygon'] as const,
    };
  }

  // Create a styled layer that will be used for line labels
  protected createLineLabelLayer(layerId: string): SymbolLayerSpecification {
    return {
      id: `${this.getSourceId()}-${layerId}-line-labels`,
      type: 'symbol' as const,
      source: this.getSourceId(),
      layout: {
        'visibility': 'visible' as const,
        'symbol-placement': 'line',
        'text-field': ['get', 'id'] as const,
        'text-font': [this.style.textFont],
        'text-size': this.style.textSize,
      },
      paint: {
        'text-color': this.style.textColor,
        'text-halo-color': 'white',
        'text-halo-width': 1,
        'text-opacity': this.style.opacity,
      },
      filter: ['==', ['geometry-type'], 'LineString'] as const,
    };
  }

  // Create a styled layer that will be used for point labels
  protected createPointLabelLayer(layerId: string): SymbolLayerSpecification {
    return {
      id: `${this.getSourceId()}-${layerId}-point-labels`,
      type: 'symbol' as const,
      source: this.getSourceId(),
      layout: {
        'visibility': 'visible' as const,
        'text-field': ['get', 'id'] as const,
        'text-font': [this.style.textFont],
        'text-size': this.style.textSize,
        'text-offset': [0, -1],
      },
      paint: {
        'text-color': this.style.textColor,
        'text-halo-color': 'white',
        'text-halo-width': 1,
        'text-opacity': this.style.opacity,
      },
      filter: ['==', ['geometry-type'], 'Point'] as const,
    };
  }
}
