import type { SourceSpecification, AddLayerObject } from 'maplibre-gl';

import Previewer from './previewer';
import Source from '../sources/source';

export type MapLibreOptions = {
  padding: number; // pixels
  opacity: number; // decimal between 0 and 1
};

const defaultOptions: MapLibreOptions = {
  padding: 40,
  opacity: 1,
} as const;

export default abstract class MapLibrePreviewer extends Previewer {
  // Stored state for added source and layers to allow for cleanup
  sourceId: string | null = null;
  layerIds: string[] = [];

  protected map: maplibregl.Map;
  protected options: MapLibreOptions;
  protected opacity: number;

  constructor(source: Source, map: maplibregl.Map, options?: Partial<MapLibreOptions>) {
    super(source);
    this.map = map;
    this.options = { ...defaultOptions, ...options } as MapLibreOptions;
    this.opacity = this.options.opacity;
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
