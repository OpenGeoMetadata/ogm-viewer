import type { SourceSpecification, AddLayerObject } from 'maplibre-gl';

import Previewer from './previewer';
import Source from '../sources/source';
import { type MapLibreStyle } from '../themes/maplibre';

export default abstract class MapLibrePreviewer extends Previewer {
  // Store reference to the map and styles
  protected style: MapLibreStyle;
  protected map: maplibregl.Map;

  // Stored state for added source and layers to allow for cleanup
  sourceId: string | null = null;
  layerIds: string[] = [];

  // Current opacity state
  protected opacity: number;

  // Initialize with opacity at the theme's opacity value
  constructor(source: Source, map: maplibregl.Map, style: MapLibreStyle) {
    super(source);
    this.map = map;
    this.style = style;
    this.opacity = this.style.opacity;
  }

  // Add source and preview layers if they don't already exist
  async preview(): Promise<void> {
    if (!this.sourceId) {
      if (this.map.getSource(this.getSourceId())) {
        return;
      }

      const source = await this.createSource();
      this.map.addSource(this.getSourceId(), source);
      this.sourceId = this.getSourceId();
    }

    if (this.layerIds.length == 0) {
      const layers = await this.createLayers();

      layers.forEach(layer => {
        if (this.map.getLayer(layer.id)) {
          return;
        }

        this.map.addLayer(layer);
        this.layerIds.push(layer.id);
      });
    }
  }

  // Remove preview layers and source
  async clearPreview() {
    this.layerIds.forEach(layerId => {
      if (this.map.getLayer(layerId)) {
        this.map.removeLayer(layerId);
      }
    });
    this.layerIds = [];

    if (this.sourceId && this.map.getSource(this.getSourceId())) {
      this.map.removeSource(this.getSourceId());
      this.sourceId = null;
    }
  }

  // Unique name for the MapLibre source; default to provided source ID
  protected getSourceId(): string {
    return this.source.id;
  }

  // Set the opacity of the preview layers
  abstract setOpacity(opacity: number): Promise<void>;

  // Get the bounds of the preview data
  abstract getBounds(): Promise<maplibregl.LngLatBoundsLike | undefined>;

  // Create MapLibre sources for the preview
  protected abstract createSource(): Promise<SourceSpecification>;

  // Create MapLibre layers for the preview
  protected abstract createLayers(): Promise<AddLayerObject[]>;
}
