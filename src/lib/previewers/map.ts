import type { SourceSpecification, AddLayerObject } from 'maplibre-gl';

import Previewer from './previewer';
import MapResource from '../resources/map';
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

  // Current opacity state
  protected opacity: number;

  // Initialize with opacity at the theme's opacity value
  constructor(resource: MapResource, map: maplibregl.Map, style: MapLibreStyle) {
    super(resource);
    this.map = map;
    this.style = style;
    this.opacity = this.style.opacity;
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
  }

  // Set the opacity of the preview layers
  abstract setOpacity(opacity: number): Promise<void>;

  // Get the bounds of the preview data
  abstract getBounds(): Promise<maplibregl.LngLatBoundsLike | undefined>;

  // Create MapLibre sources for the preview
  protected abstract createSources(): Promise<AddSourceObject[]>;

  // Create MapLibre layers for the preview
  protected abstract createLayers(): Promise<AddLayerObject[]>;
}
