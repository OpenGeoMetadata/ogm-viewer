import type { AddLayerObject, LngLatBoundsLike, MapGeoJSONFeature, MapLibreMap, SourceSpecification } from 'maplibre-gl';

import type Resource from '../resources/resource';

import Previewer from './previewer';
import { isLayerDrawn, resolveLayerState, type LayerState, type Layer, type PreviewStyleLayer } from '../layers';
import type { LegendEntry } from '../legend';
import { defaultBeforeId, type MapLibreStyle } from '../themes/maplibre';

type AddSourceObject = SourceSpecification & { id: string };

export type MapProjection = 'globe' | 'mercator';

export default abstract class MapPreviewer extends Previewer {
  readonly renderer = 'map' as const;

  readonly projection: MapProjection = 'globe';

  // Time allowed for the first tile to arrive; later tiles may continue loading afterward.
  readonly loadTimeout: number = 20_000;

  readonly maxPitch?: number;

  minZoom?: number;

  /** Basemap layer to draw beneath; an empty or missing layer ID places the preview above the basemap. */
  beforeId?: string = defaultBeforeId;

  declare protected resource: Resource;

  protected style: MapLibreStyle;
  protected map: MapLibreMap;

  // Custom renderers use this hook for tile failures that arrive after preview() resolves.
  onError?: (error: unknown) => void;

  onDrawn?: () => void;

  onLayersChanged?: () => void;

  onNotice?: (notice: string | undefined) => void;

  onLoading?: (loading: boolean) => void;

  async expandFeatures(features: MapGeoJSONFeature[]): Promise<MapGeoJSONFeature[]> {
    return features;
  }

  tileLoaded(_sourceId: string, _zoom: number): void {}

  absorbTileError(_sourceId: string, _zoom: number): boolean {
    return false;
  }

  loadTimeDomain(_id: string): void {}

  // Use a property filter for selected vector-tile features that lack a feature-state ID.
  matchSelection(_feature?: MapGeoJSONFeature): void {}

  readonly reportsDrawing: boolean = false;

  get legendEntries(): LegendEntry[] {
    return [];
  }

  sourceIds: string[] = [];
  layerIds: string[] = [];

  previewLayers: Layer[] = [];

  // The map owns user choices because a style rebuild recreates this previewer's layers.
  private layerState: ReadonlyMap<string, LayerState> = new Map();

  attach(map: MapLibreMap, style: MapLibreStyle): this {
    this.map = map;
    this.style = style;
    return this;
  }

  protected get attached(): boolean {
    return this.map !== undefined;
  }

  async preview(): Promise<void> {
    this.sourceIds = [];
    this.layerIds = [];
    this.previewLayers = [];

    const sources = await this.createSources();

    sources.forEach(source => {
      const { id, ...sourceSpec } = source as AddSourceObject;
      this.sourceIds.push(id);
      if (this.map.getSource(id)) return;
      this.map.addSource(id, sourceSpec);
    });

    const layers = await this.createLayers();
    const beforeId = this.resolvedBeforeId;

    layers.forEach(layer => {
      this.layerIds.push(layer.id);
      const existing = this.map.getLayer(layer.id);

      if (existing && layer.type !== 'custom') return;

      // Reattach custom layer objects so onAdd receives the context from the rebuilt style.
      if (existing) this.map.removeLayer(layer.id);

      this.map.addLayer(layer, layer.type === 'symbol' ? undefined : beforeId);
    });
  }

  protected get resolvedBeforeId(): string | undefined {
    const beforeId = this.beforeId;
    return beforeId && this.map.getLayer(beforeId) ? beforeId : undefined;
  }

  async clearPreview() {
    if (!this.attached) return;

    this.layerIds.forEach(layerId => {
      if (this.map.getLayer(layerId)) {
        this.map.removeLayer(layerId);
      }
    });
    this.layerIds = [];

    this.sourceIds.forEach(sourceId => {
      if (this.map.getSource(sourceId)) {
        this.map.removeSource(sourceId);
      }
    });
    this.sourceIds = [];
    this.previewLayers = [];
    this.layerState = new Map();
  }

  applyLayerState(states: ReadonlyMap<string, LayerState>) {
    this.layerState = states;

    this.previewLayers.forEach(layer => {
      const state = resolveLayerState(layer, states);
      layer.styleLayers.forEach(styleLayer => this.applyStyleLayerState(styleLayer, state));
    });
  }

  protected applyStyleLayerState(styleLayer: PreviewStyleLayer, state: LayerState) {
    if (!this.map.getLayer(styleLayer.id)) return;

    // Zero opacity must also hide the layer because transparent features still match rendered queries.
    this.map.setLayoutProperty(styleLayer.id, 'visibility', isLayerDrawn(state) ? 'visible' : 'none');

    if (!styleLayer.internal) this.applyOpacity(styleLayer, state.opacity);
  }

  // Only query existing layers; MapLibre rejects the whole query if any requested layer is absent.
  get visibleLayerIds(): string[] {
    return this.previewLayers.flatMap(layer => {
      if (!isLayerDrawn(resolveLayerState(layer, this.layerState))) return [];
      return layer.styleLayers.filter(styleLayer => !styleLayer.internal).map(styleLayer => styleLayer.id);
    });
  }

  get anyLayerVisible(): boolean {
    return this.previewLayers.some(layer => isLayerDrawn(resolveLayerState(layer, this.layerState)));
  }

  protected applyOpacity(styleLayer: PreviewStyleLayer, opacity: number) {
    switch (styleLayer.type) {
      case 'raster':
        this.map.setPaintProperty(styleLayer.id, 'raster-opacity', opacity);
        break;
      case 'fill':
        this.map.setPaintProperty(styleLayer.id, 'fill-opacity', opacity);
        break;
      case 'line':
        this.map.setPaintProperty(styleLayer.id, 'line-opacity', opacity);
        break;
      case 'circle':
        this.map.setPaintProperty(styleLayer.id, 'circle-opacity', opacity);
        this.map.setPaintProperty(styleLayer.id, 'circle-stroke-opacity', opacity);
        break;
      case 'symbol':
        this.map.setPaintProperty(styleLayer.id, 'text-opacity', opacity);
        break;
    }
  }

  protected layerDrawn(id: string): boolean {
    const layer = this.findPreviewLayer(id);
    return layer !== undefined && isLayerDrawn(resolveLayerState(layer, this.layerState));
  }

  protected findPreviewLayer(id: string): Layer | undefined {
    return this.previewLayers.find(layer => layer.id === id);
  }

  get declaredBounds(): LngLatBoundsLike | undefined {
    return this.resource.declaredBounds;
  }

  async getBounds(): Promise<LngLatBoundsLike | undefined> {
    return await this.resource.getBounds();
  }

  async getReportedBounds(): Promise<LngLatBoundsLike | undefined> {
    return await this.resource.getReportedBounds();
  }

  protected abstract createSources(): Promise<AddSourceObject[]>;

  protected abstract createLayers(): Promise<AddLayerObject[]>;
}
