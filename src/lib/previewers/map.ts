import type { SourceSpecification, AddLayerObject } from 'maplibre-gl';

import Previewer from './previewer';
import MapResource from '../resources/map';
import { isLayerDrawn, resolveLayerState, type LayerState, type PreviewLayer, type PreviewStyleLayer } from '../layers';
import { type MapLibreStyle } from '../themes/maplibre';

// MapLibre doesn't bundle the id with the source, but we need to
type AddSourceObject = SourceSpecification & { id: string };

export default abstract class MapPreviewer extends Previewer {
  declare protected resource: MapResource;

  // Store reference to the map and styles
  protected style: MapLibreStyle;
  protected map: maplibregl.Map;

  // Stored state for added MapLibre sources and layers to allow for cleanup
  sourceIds: string[] = [];
  layerIds: string[] = [];

  // The logical layers this preview offers the reader, in the order they're painted. Subclasses
  // fill this in from createLayers(), which is the only code that knows how one resource expands
  // into style layers.
  previewLayers: PreviewLayer[] = [];

  // A memo of the last instruction applyLayerState was given, not a source of truth: ogm-map owns
  // the reader's choices, because setStyle rebuilds this object from scratch on every theme change.
  private layerState: ReadonlyMap<string, LayerState> = new Map();

  constructor(resource: MapResource, map: maplibregl.Map, style: MapLibreStyle) {
    super(resource);
    this.map = map;
    this.style = style;
  }

  // Add source and preview layers if they don't already exist
  async preview(): Promise<void> {
    const sources = await this.createSources();

    sources.forEach(source => {
      const { id, ...sourceSpec } = source as AddSourceObject;
      if (this.map.getSource(id)) return;
      this.map.addSource(id, sourceSpec);
      this.sourceIds.push(id);
    });

    const layers = await this.createLayers();

    layers.forEach(layer => {
      if (this.map.getLayer(layer.id)) return;
      this.map.addLayer(layer);
      this.layerIds.push(layer.id);
    });
  }

  // Remove preview layers and sources
  async clearPreview() {
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

  // Push the reader's choices onto the layers already on the map. Idempotent: every value is
  // rebuilt from the theme and the requested state rather than read back off the map, so
  // re-applying it - after a basemap swap, or on every frame of a slider drag - can't compound.
  // Callers must only call this once the style document itself has loaded, since setPaintProperty
  // throws before that.
  applyLayerState(states: ReadonlyMap<string, LayerState>) {
    this.layerState = states;

    this.previewLayers.forEach(layer => {
      const state = resolveLayerState(layer, states);

      layer.styleLayers.forEach(styleLayer => {
        // A layer the style no longer holds is one a rebuild hasn't finished replacing
        if (!this.map.getLayer(styleLayer.id)) return;

        // An opacity of zero has to hide the layer outright, not just make it invisible:
        // queryRenderedFeatures skips layers set to `visibility: none` but still reports features
        // from a layer drawn at zero opacity, which would let a reader click what they can't see.
        this.map.setLayoutProperty(styleLayer.id, 'visibility', isLayerDrawn(state) ? 'visible' : 'none');

        // A highlight is drawn for us by the server we asked; dimming it would make the answer
        // harder to read at exactly the moment the reader asked for it
        if (!styleLayer.internal) this.applyOpacity(styleLayer, state.opacity);
      });
    });
  }

  // The style layers a rendered-feature query should consider. Always a subset of layerIds:
  // queryRenderedFeatures errors and returns nothing for the whole query if it names a layer the
  // style doesn't hold.
  get visibleLayerIds(): string[] {
    return this.previewLayers.flatMap(layer => {
      if (!isLayerDrawn(resolveLayerState(layer, this.layerState))) return [];
      return layer.styleLayers.filter(styleLayer => !styleLayer.internal).map(styleLayer => styleLayer.id);
    });
  }

  // Whether any of this preview is drawn. A server-drawn raster has no client-side features to
  // filter a query by, so ogm-map has to ask before offering to inspect one.
  get anyLayerVisible(): boolean {
    return this.previewLayers.some(layer => isLayerDrawn(resolveLayerState(layer, this.layerState)));
  }

  // Write the opacity a style layer carries. Only the property its type owns: MapLibre rejects a
  // paint property a layer type doesn't define, and fires an error on the map when it does.
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

  protected findPreviewLayer(id: string): PreviewLayer | undefined {
    return this.previewLayers.find(layer => layer.id === id);
  }

  // Get the bounds of the preview data
  abstract getBounds(): Promise<maplibregl.LngLatBoundsLike | undefined>;

  // Create MapLibre sources for the preview
  protected abstract createSources(): Promise<AddSourceObject[]>;

  // Create MapLibre layers for the preview
  protected abstract createLayers(): Promise<AddLayerObject[]>;
}
