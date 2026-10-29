import MapPreviewer from './map';
import type {
  ExpressionSpecification,
  FillLayerSpecification,
  FilterSpecification,
  LineLayerSpecification,
  CircleLayerSpecification,
  SymbolLayerSpecification,
  LayerSpecification,
  MapGeoJSONFeature,
  VectorSourceSpecification,
} from 'maplibre-gl';

import { propertyFilter } from '../features';
import type { Layer, PreviewStyleLayer } from '../layers';
import type VectorResource from '../resources/vector';

export type AddVectorSourceObject = VectorSourceSpecification & { id: string };

export const previewStyleLayers = (layers: LayerSpecification[]): PreviewStyleLayer[] => layers.map(({ id, type }) => ({ id, type }));

type GeometryLayerSpecification = FillLayerSpecification | LineLayerSpecification | CircleLayerSpecification;

const IS_SELECTED: ExpressionSpecification = ['boolean', ['feature-state', 'selected'], false];

const SELECTED_ONLY: ExpressionSpecification = ['case', IS_SELECTED, 1, 0];

const MATCH_NONE: ExpressionSpecification = ['literal', false];

const answerSelected = <T>(value: T): T => {
  if (JSON.stringify(value) === JSON.stringify(IS_SELECTED)) return true as T;
  if (Array.isArray(value)) return value.map(answerSelected) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, answerSelected(inner)])) as T;
  return value;
};

type MatchedLayer = { id: string; source: string; sourceLayer?: string; filter?: FilterSpecification };

export default abstract class VectorPreviewer extends MapPreviewer {
  declare protected resource: VectorResource;

  protected readonly featuresMayLackIds: boolean = false;

  private matchedLayers: MatchedLayer[] = [];

  protected getSourceId(): string {
    return this.resource.id;
  }

  protected getDefaultOpacity(): number {
    return this.style.opacity;
  }

  protected getLabelOpacity(): number {
    return this.getDefaultOpacity();
  }

  protected async zoomRange(): Promise<{ minzoom?: number; maxzoom?: number }> {
    return {};
  }

  // MapLibre places lower sort keys first and rejects overlapping labels placed later.
  protected labelPriority(): { 'symbol-sort-key'?: ExpressionSpecification } {
    return {};
  }

  protected async createLayers(): Promise<LayerSpecification[]> {
    const layerIds = await this.resource.getVectorLayers();
    const range = await this.zoomRange();
    this.matchedLayers = [];

    return layerIds.flatMap(layerId => {
      const geometry = [this.createPolygonLayer(layerId), this.createPolygonOutlineLayer(layerId), this.createLineLayer(layerId), this.createPointLayer(layerId)];
      const labels = [this.createPolygonLabelLayer(layerId), this.createLineLabelLayer(layerId), this.createPointLabelLayer(layerId)];
      const selected = geometry.map(layer => this.createSelectedLayer(layer));
      const matched = this.featuresMayLackIds ? geometry.map(layer => this.createMatchedLayer(layer)) : [];

      this.previewLayers.push(...this.createPreviewLayers(layerId, geometry, labels));
      this.matchedLayers.push(
        ...matched.map(({ id }, index) => ({ id, source: geometry[index].source, sourceLayer: geometry[index]['source-layer'], filter: geometry[index].filter })),
      );

      this.findPreviewLayer(this.previewLayerId(layerId))?.styleLayers.push(
        ...previewStyleLayers([...selected, ...matched]).map(styleLayer => ({ ...styleLayer, internal: true })),
      );

      return [...geometry.flatMap((layer, index) => [layer, selected[index], ...matched.slice(index, index + 1)]), ...labels].map(layer => Object.assign(layer, range));
    });
  }

  matchSelection(feature?: MapGeoJSONFeature) {
    const match = feature && propertyFilter(feature);

    this.matchedLayers.forEach(layer => {
      if (!this.map.getLayer(layer.id)) return;
      const ours = feature !== undefined && match !== undefined && feature.source === layer.source && feature.sourceLayer === layer.sourceLayer;
      this.map.setFilter(layer.id, this.matchedFilter(layer.filter, ours ? match : MATCH_NONE));
    });
  }

  private matchedFilter(filter: FilterSpecification | undefined, match: ExpressionSpecification): FilterSpecification {
    return filter === undefined ? match : ['all', filter as ExpressionSpecification, match];
  }

  private createMatchedLayer(layer: GeometryLayerSpecification): GeometryLayerSpecification {
    const copy = this.createSelectedLayer(layer);
    return { ...copy, id: `${layer.id}-matched`, paint: answerSelected(copy.paint), filter: this.matchedFilter(layer.filter, MATCH_NONE) } as GeometryLayerSpecification;
  }

  // Draw selection in a separate layer so later features cannot cover an older selected feature.
  private createSelectedLayer(layer: GeometryLayerSpecification): GeometryLayerSpecification {
    const id = `${layer.id}-selected`;

    switch (layer.type) {
      case 'fill':
        return { ...layer, id, paint: { ...layer.paint, 'fill-opacity': SELECTED_ONLY } };
      case 'line':
        return { ...layer, id, paint: { ...layer.paint, 'line-opacity': SELECTED_ONLY } };
      case 'circle':
        return { ...layer, id, paint: { ...layer.paint, 'circle-opacity': SELECTED_ONLY, 'circle-stroke-opacity': SELECTED_ONLY } };
    }
  }

  protected createPreviewLayers(layerId: string, geometry: LayerSpecification[], labels: LayerSpecification[]): Layer[] {
    return [
      {
        id: this.previewLayerId(layerId),
        title: this.previewLayerTitle(layerId),
        defaultOpacity: this.getDefaultOpacity(),
        styleLayers: previewStyleLayers([...geometry, ...labels]),
      },
    ];
  }

  protected previewLayerId(layerId: string): string {
    return `${this.getSourceId()}-${layerId}`;
  }

  protected previewLayerTitle(_layerId: string): string {
    return this.resource.label();
  }

  protected selectedOpacity(opacity: number): ExpressionSpecification {
    return ['case', IS_SELECTED, 1, opacity];
  }

  protected dataColorExpression(): ExpressionSpecification {
    return [
      'case',
      IS_SELECTED,
      this.style.selectedColor,
      ['boolean', ['feature-state', 'hover'], false],
      this.style.highlightColor,
      ['==', ['get', 'available'], false],
      this.style.invalidColor,
      this.style.dataColor,
    ];
  }

  protected strokeColorExpression(): ExpressionSpecification {
    return [
      'case',
      IS_SELECTED,
      this.style.strokeSelectedColor,
      ['boolean', ['feature-state', 'hover'], false],
      this.style.strokeHighlightColor,
      ['==', ['get', 'available'], false],
      this.style.strokeInvalidColor,
      this.style.strokeColor,
    ];
  }

  protected applyOpacity(styleLayer: PreviewStyleLayer, opacity: number) {
    if (styleLayer.type === 'fill') {
      this.map.setPaintProperty(styleLayer.id, 'fill-opacity', this.selectedOpacity(opacity));
    } else if (styleLayer.type === 'circle') {
      this.map.setPaintProperty(styleLayer.id, 'circle-opacity', this.selectedOpacity(opacity));
      this.map.setPaintProperty(styleLayer.id, 'circle-stroke-opacity', opacity);
    } else {
      super.applyOpacity(styleLayer, opacity);
    }
  }

  protected createPolygonLayer(layerId: string): FillLayerSpecification {
    return {
      id: `${this.getSourceId()}-${layerId}-polygons`,
      type: 'fill' as const,
      source: this.getSourceId(),
      layout: {
        visibility: 'visible' as const,
      },
      paint: {
        'fill-color': this.dataColorExpression(),
        'fill-opacity': this.selectedOpacity(this.getDefaultOpacity()),
      },
      filter: ['==', ['geometry-type'], 'Polygon'] as const,
    };
  }

  protected createPolygonOutlineLayer(layerId: string): LineLayerSpecification {
    return {
      id: `${this.getSourceId()}-${layerId}-polygon-outlines`,
      type: 'line' as const,
      source: this.getSourceId(),
      layout: {
        visibility: 'visible' as const,
      },
      paint: {
        'line-color': this.strokeColorExpression(),
        'line-width': ['case', IS_SELECTED, 2, 1] as const,
        'line-opacity': this.getDefaultOpacity(),
      },
      filter: ['==', ['geometry-type'], 'Polygon'] as const,
    };
  }

  protected createLineLayer(layerId: string): LineLayerSpecification {
    return {
      id: `${this.getSourceId()}-${layerId}-lines`,
      type: 'line' as const,
      source: this.getSourceId(),
      layout: {
        visibility: 'visible' as const,
      },
      paint: {
        'line-color': this.dataColorExpression(),
        'line-width': 4,
        'line-opacity': this.getDefaultOpacity(),
      },
      filter: ['==', ['geometry-type'], 'LineString'] as const,
    };
  }

  protected createPointLayer(layerId: string): CircleLayerSpecification {
    return {
      id: `${this.getSourceId()}-${layerId}-points`,
      type: 'circle' as const,
      source: this.getSourceId(),
      layout: {
        visibility: 'visible' as const,
      },
      paint: {
        'circle-color': this.dataColorExpression(),
        'circle-stroke-color': this.strokeColorExpression(),
        'circle-stroke-width': ['case', IS_SELECTED, 2, 1] as const,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 2, 12, 4] as const,
        'circle-opacity': this.selectedOpacity(this.getDefaultOpacity()),
        'circle-stroke-opacity': this.getDefaultOpacity(),
      },
      filter: ['==', ['geometry-type'], 'Point'] as const,
    };
  }

  protected createPolygonLabelLayer(layerId: string): SymbolLayerSpecification {
    return {
      id: `${this.getSourceId()}-${layerId}-polygon-labels`,
      type: 'symbol' as const,
      source: this.getSourceId(),
      layout: {
        'visibility': 'visible' as const,
        'text-field': ['coalesce', ['get', 'label'], ['get', 'id']] as const,
        'text-font': [this.style.textFont],
        'text-size': this.style.textSize,
        ...this.labelPriority(),
      },
      paint: {
        'text-color': this.style.textColor,
        'text-halo-color': this.style.textHaloColor,
        'text-halo-width': 1,
        'text-opacity': this.getLabelOpacity(),
      },
      filter: ['==', ['geometry-type'], 'Polygon'] as const,
    };
  }

  protected createLineLabelLayer(layerId: string): SymbolLayerSpecification {
    return {
      id: `${this.getSourceId()}-${layerId}-line-labels`,
      type: 'symbol' as const,
      source: this.getSourceId(),
      layout: {
        'visibility': 'visible' as const,
        'symbol-placement': 'line',
        'text-field': ['coalesce', ['get', 'label'], ['get', 'id']] as const,
        'text-font': [this.style.textFont],
        'text-size': this.style.textSize,
        ...this.labelPriority(),
      },
      paint: {
        'text-color': this.style.textColor,
        'text-halo-color': this.style.textHaloColor,
        'text-halo-width': 1,
        'text-opacity': this.getLabelOpacity(),
      },
      filter: ['==', ['geometry-type'], 'LineString'] as const,
    };
  }

  protected createPointLabelLayer(layerId: string): SymbolLayerSpecification {
    return {
      id: `${this.getSourceId()}-${layerId}-point-labels`,
      type: 'symbol' as const,
      source: this.getSourceId(),
      layout: {
        'visibility': 'visible' as const,
        'text-field': ['coalesce', ['get', 'label'], ['get', 'id']] as const,
        'text-font': [this.style.textFont],
        'text-size': this.style.textSize,
        'text-offset': [0, -1],
        ...this.labelPriority(),
      },
      paint: {
        'text-color': this.style.textColor,
        'text-halo-color': this.style.textHaloColor,
        'text-halo-width': 1,
        'text-opacity': this.getLabelOpacity(),
      },
      filter: ['==', ['geometry-type'], 'Point'] as const,
    };
  }
}
