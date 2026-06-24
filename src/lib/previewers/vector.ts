import MapLibrePreviewer, { MapLibreOptions } from './maplibre';
import type { FillLayerSpecification, LineLayerSpecification, CircleLayerSpecification, SymbolLayerSpecification, LayerSpecification } from 'maplibre-gl';

import type VectorSource from '../sources/vector';

type VectorOptions = {
  fillColor: string; // CSS color string
  fillHighlightColor: string; // CSS color string
  fillInvalidColor: string; // CSS color string
  lineColor: string; // CSS color string
  lineHighlightColor: string; // CSS color string
  textColor: string; // CSS color string
  fillOpacity: number; // decimal between 0 and 1
  fillHighlightOpacity: number; // decimal between 0 and 1
  labelFont: string; // CSS font-family string
  labelSize: number; // in pixels
};

export type Options = MapLibreOptions & VectorOptions;

const defaultOptions: VectorOptions = {
  fillColor: '#00ccff',
  fillHighlightColor: '#00ff00',
  fillInvalidColor: '#ffcc00',
  lineColor: '#555555',
  lineHighlightColor: '#00ff00',
  textColor: '#222222',
  fillOpacity: 0.6,
  fillHighlightOpacity: 0.8,
  labelFont: 'Noto Sans Regular',
  labelSize: 10,
};

export default abstract class VectorPreviewer extends MapLibrePreviewer {
  declare protected source: VectorSource;
  declare protected options: Options;

  constructor(source: VectorSource, map: maplibregl.Map, options?: Partial<Options>) {
    super(source, map, options);
    this.options = { ...defaultOptions, ...options } as Options;
  }

  // Set opacity of all layers in this previewer
  async setOpacity(opacity: number) {
    this.opacity = opacity;
    if (this.layerIds.length > 0) {
      await Promise.all(this.layerIds.map(id => this.map.setPaintProperty(id, 'fill-opacity', this.opacity / 100)));
    }
  }

  async getBounds() {
    return await this.source.getBounds();
  }

  protected async createLayers(): Promise<LayerSpecification[]> {
    const layerIds = await this.source.getVectorLayers();
    return layerIds.flatMap(layerId => {
      return [
        this.createPolygonLayer(layerId),
        this.createPolygonOutlineLayer(layerId),
        this.createLineLayer(layerId),
        this.createPointLayer(layerId),
        this.createPolygonLabelLayer(layerId),
        this.createLineLabelLayer(layerId),
        this.createPointLabelLayer(layerId),
      ];
    });
  }

  // Create a styled layer that will be used for polygon geometry
  protected createPolygonLayer(layerId: string): FillLayerSpecification {
    return {
      id: `${this.getSourceId()}-${layerId}-polygons`,
      type: 'fill' as const,
      source: this.getSourceId(),
      paint: {
        'fill-color': ['case', ['boolean', ['feature-state', 'selected'], false], this.options.fillHighlightColor, this.options.fillColor] as const,
        'fill-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], this.options.fillHighlightOpacity, this.options.fillOpacity] as const,
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
      paint: {
        'line-color': ['case', ['boolean', ['feature-state', 'selected'], false], this.options.lineHighlightColor, this.options.lineColor] as const,
        'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 2, 1] as const,
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
      paint: {
        'line-color': ['case', ['boolean', ['feature-state', 'selected'], false], this.options.lineHighlightColor, this.options.lineColor] as const,
        'line-width': 4,
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
      paint: {
        'circle-color': ['case', ['boolean', ['feature-state', 'selected'], false], this.options.fillHighlightColor, this.options.fillColor] as const,
        'circle-stroke-color': ['case', ['boolean', ['feature-state', 'selected'], false], this.options.lineHighlightColor, this.options.lineColor] as const,
        'circle-stroke-width': ['case', ['boolean', ['feature-state', 'selected'], false], 2, 1] as const,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 2, 12, 4] as const,
        'circle-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], this.options.fillHighlightOpacity, this.options.fillOpacity] as const,
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
        'text-field': ['get', 'id'] as const,
        'text-font': [this.options.labelFont],
        'text-max-angle': 85,
        'text-size': this.options.labelSize,
        'text-offset': [0, 1],
        'text-anchor': 'bottom',
        'text-rotation-alignment': 'map',
        'text-keep-upright': true,
        'symbol-placement': 'line',
        'symbol-spacing': 250,
      },
      paint: {
        'text-color': this.options.textColor,
        'text-halo-color': 'white',
        'text-halo-width': 1,
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
        'symbol-placement': 'line',
        'text-field': ['get', 'id'] as const,
        'text-font': [this.options.labelFont],
        'text-size': this.options.labelSize,
      },
      paint: {
        'text-color': this.options.textColor,
        'text-halo-color': 'white',
        'text-halo-width': 1,
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
        'text-field': ['get', 'id'] as const,
        'text-font': [this.options.labelFont],
        'text-size': this.options.labelSize,
        'text-offset': [0, -1],
      },
      paint: {
        'text-color': this.options.textColor,
        'text-halo-color': 'white',
        'text-halo-width': 1,
      },
      filter: ['==', ['geometry-type'], 'Point'] as const,
    };
  }
}
