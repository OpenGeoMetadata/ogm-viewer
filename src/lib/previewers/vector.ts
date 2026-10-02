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

import type { Layer, PreviewStyleLayer } from '../layers';
import type VectorResource from '../resources/vector';

// MapLibre doesn't bundle the id with the source, but we need to
export type AddVectorSourceObject = VectorSourceSpecification & { id: string };

// What a row in the layers panel records about the style layers it draws: an id to set properties
// on, and the type that decides which property that is.
export const previewStyleLayers = (layers: LayerSpecification[]): PreviewStyleLayer[] => layers.map(({ id, type }) => ({ id, type }));

// The style layers that draw a feature's shape, as opposed to its label
type GeometryLayerSpecification = FillLayerSpecification | LineLayerSpecification | CircleLayerSpecification;

// Every feature but the selected one, transparent
const SELECTED_ONLY: ExpressionSpecification = ['case', ['boolean', ['feature-state', 'selected'], false], 1, 0];

export default abstract class VectorPreviewer extends MapPreviewer {
  declare protected resource: VectorResource;

  protected getSourceId(): string {
    return this.resource.id;
  }

  protected getDefaultOpacity(): number {
    return this.style.opacity;
  }

  protected getLabelOpacity(): number {
    return this.getDefaultOpacity();
  }

  // The window of zooms these layers should be drawn in, for a resource whose service publishes
  // one. Nothing by default, which is every zoom - what every vector preview has always had.
  protected async zoomRange(): Promise<{ minzoom?: number; maxzoom?: number }> {
    return {};
  }

  // Which label MapLibre keeps where labels collide. It places them in ascending order of
  // symbol-sort-key and drops any that would overlap one already placed, so without a key they go in
  // the order the source holds them - and a stack of features sharing an outline is labelled with the
  // first of them, the one drawn under all the rest, which a click lists last. Nothing by default:
  // MapLibre draws a tile's features in the order the tile holds them, and an expression can't read
  // that order, so a tileset has no key that would say which of a stack is on top.
  protected labelPriority(): { 'symbol-sort-key'?: ExpressionSpecification } {
    return {};
  }

  protected async createLayers(): Promise<LayerSpecification[]> {
    const layerIds = await this.resource.getVectorLayers();
    const range = await this.zoomRange();

    return layerIds.flatMap(layerId => {
      const geometry = [this.createPolygonLayer(layerId), this.createPolygonOutlineLayer(layerId), this.createLineLayer(layerId), this.createPointLayer(layerId)];
      const labels = [this.createPolygonLabelLayer(layerId), this.createLineLabelLayer(layerId), this.createPointLabelLayer(layerId)];
      const selected = geometry.map(layer => this.createSelectedLayer(layer));

      this.previewLayers.push(...this.createPreviewLayers(layerId, geometry, labels));

      // The copies go with the row their features are drawn in, so they hide when it does, but
      // flagged internal: the selected feature stays solid at any opacity, and a click mustn't find
      // every feature twice.
      this.findPreviewLayer(this.previewLayerId(layerId))?.styleLayers.push(...previewStyleLayers(selected).map(styleLayer => ({ ...styleLayer, internal: true })));

      // Written over the finished specs rather than into each of the seven builders, and after the
      // panel rows have been taken from them, which read only an id and a type. An empty range
      // leaves each layer exactly as its builder made it. Each copy goes directly over the layer it
      // copies, so the selected feature is lifted over its own kind of shape and nothing else: a
      // selected polygon still has the outlines, lines and points drawn over it that it always had.
      return [...geometry.flatMap((layer, index) => [layer, selected[index]]), ...labels].map(layer => Object.assign(layer, range));
    });
  }

  // A geometry layer drawn a second time, directly over itself, showing only the selected feature.
  // MapLibre draws features in the order their source lists them, and feature-state can recolour a
  // feature but can't move it, so a selected feature with others listed after it was highlighted
  // underneath them. An index map stacks a sheet's editions that way, latest last, and the popup pages
  // down the stack from the top - so every edition but the first it showed was selected out of
  // sight, and the oldest, under all the rest, looked like no edition was selected at all. In the copy
  // the selected feature is drawn over its stack wherever it sits in it, and solid, the way a
  // selected fill already was at any opacity (see selectedOpacity).
  //
  // Everything but the id and paint is the layer's own, so the copy reads exactly the features its
  // layer does. That is also what MapLibre groups layers by, so both are built from one bucket.
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

  // How a layer's style layers are grouped into the rows a user sees in the panel.
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

  // What the row holding this layer is called on the map's own state, as opposed to in the panel.
  // Built from the source id for the reason the style layer ids are: one record can reference the
  // same data more than one way, and two rows under one id are one row to everything downstream.
  protected previewLayerId(layerId: string): string {
    return `${this.getSourceId()}-${layerId}`;
  }

  // What to call this layer in the control. A single-layer source names its one layer for our own
  // benefit ('geojson', 'indexmap'), which would tell a user nothing, so the resource's own
  // label is the better name; a tileset that names its layers itself overrides this.
  protected previewLayerTitle(_layerId: string): string {
    return this.resource.label();
  }

  // A fill doesn't carry its opacity as a number: a selected feature is drawn at a different opacity
  // from the rest, and that is an expression over feature-state. The layer's opacity has to be
  // written into the unselected branch alone - a flat number over the whole expression would take
  // the selection highlight with it, which is the one thing a user adjusting opacity still needs
  // to see. So the selected feature stays solid at any opacity: someone who faded a layer down to
  // read the basemap through it has all the more reason to want the feature they clicked to stand out.
  protected selectedOpacity(opacity: number): ExpressionSpecification {
    return ['case', ['boolean', ['feature-state', 'selected'], false], 1, opacity];
  }

  // Selection and hover are transient client-side state, set via feature-state; availability is
  // static per-feature data already on the GeoJSON, read straight off its properties. Selected/
  // hover still win so a user can inspect an unavailable feature without losing that feedback.
  protected dataColorExpression(): ExpressionSpecification {
    return [
      'case',
      ['boolean', ['feature-state', 'selected'], false],
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
      ['boolean', ['feature-state', 'selected'], false],
      this.style.strokeSelectedColor,
      ['boolean', ['feature-state', 'hover'], false],
      this.style.strokeHighlightColor,
      ['==', ['get', 'available'], false],
      this.style.strokeInvalidColor,
      this.style.strokeColor,
    ];
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
        'fill-color': this.dataColorExpression(),
        'fill-opacity': this.selectedOpacity(this.getDefaultOpacity()),
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
        'line-color': this.strokeColorExpression(),
        'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 2, 1] as const,
        'line-opacity': this.getDefaultOpacity(),
      },
      filter: ['==', ['geometry-type'], 'Polygon'] as const,
    };
  }

  // Create a styled layer that will be used for line geometry. Drawn in the data color, not the
  // stroke color: a LineString is the thing being shown, the same as a polygon's fill is, and it has
  // no outline for the stroke color to be the outline of.
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
        'circle-color': this.dataColorExpression(),
        'circle-stroke-color': this.strokeColorExpression(),
        'circle-stroke-width': ['case', ['boolean', ['feature-state', 'selected'], false], 2, 1] as const,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 2, 12, 4] as const,
        'circle-opacity': this.selectedOpacity(this.getDefaultOpacity()),
        'circle-stroke-opacity': this.getDefaultOpacity(),
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

  // Create a styled layer that will be used for line labels
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

  // Create a styled layer that will be used for point labels
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
