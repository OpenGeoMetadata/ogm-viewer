import type { AddLayerObject, CustomLayerInterface, Evented, LngLatBoundsLike } from 'maplibre-gl';
import { WarpedMapLayer } from '@allmaps/maplibre';

import MapPreviewer from './map';
import { backgroundColorOf } from '../background-color';
import type IIIFManifestResource from '../resources/iiif-manifest';
import type { LayerState, PreviewStyleLayer } from '../layers';

const FIRST_TILE_EVENT = 'firstmaptileloaded';

type WarpedMapLayerEvent = { type: string; layerId?: string; mapIds?: string[] };

type WarpedMapEvented = Evented<Record<typeof FIRST_TILE_EVENT, WarpedMapLayerEvent>>;

// Match the Allmaps Viewer background-removal settings for consistent paper removal.
const REMOVE_COLOR_THRESHOLD = 1 / 3;
const REMOVE_COLOR_HARDNESS = 0.1;

export default class GeoreferencePreviewer extends MapPreviewer {
  declare protected resource: IIIFManifestResource;

  // Allmaps derives its own flat viewport, so this layer cannot follow globe projection.
  readonly projection = 'mercator' as const;

  readonly maxPitch = 0;

  readonly reportsDrawing = true;

  protected layer: WarpedMapLayer | undefined;

  private backgroundColors = new Map<string, string>();

  private detecting = new Set<string>();

  private backgroundRemoved: boolean | undefined;

  label() {
    return 'Georeferenced map';
  }

  protected async createSources(): Promise<[]> {
    return [];
  }

  protected getLayerId(): string {
    return `${this.resource.id}-georeference`;
  }

  protected async createLayers(): Promise<AddLayerObject[]> {
    this.layer = new WarpedMapLayer({ layerId: this.getLayerId() });
    this.backgroundRemoved = undefined;

    this.previewLayers.push({
      id: this.getLayerId(),
      title: this.label(),
      defaultOpacity: this.style.opacity,
      styleLayers: [{ id: this.getLayerId(), type: 'custom' }],
      backgroundRemovable: this.backgroundColors.size > 0,
    });

    // Allmaps declares its custom-layer interface against MapLibre 5; the runtime shape is compatible.
    return [this.layer as unknown as CustomLayerInterface];
  }

  // Attach the layer first; Allmaps creates the renderer that accepts annotations in onAdd.
  async preview(): Promise<void> {
    const annotation = await this.resource.getGeoreferenceAnnotation();

    if (!annotation) throw new Error('This manifest has no georeference annotation to draw.');

    await super.preview();

    // Allmaps returns per-map failures; usable maps in the same annotation should still render.
    const results = this.layer?.addGeoreferenceAnnotation(annotation) ?? [];
    const errors = results.flatMap(result => (result.ok === false ? [result.error] : []));

    errors.forEach(error => console.warn(`Could not read a georeferenced map in ${this.url}:`, error));
    if (errors.length === results.length) throw errors[0] ?? new Error('The georeference annotation described no maps that could be drawn.');

    this.watchFirstTile();
  }

  // Remove the previous listener because a style rebuild reuses the previewer without clearing it.
  protected watchFirstTile() {
    const events = this.map as unknown as WarpedMapEvented;
    events.off(FIRST_TILE_EVENT, this.handleFirstTile);
    events.on(FIRST_TILE_EVENT, this.handleFirstTile);
  }

  private handleFirstTile = (event: WarpedMapLayerEvent) => {
    if (event.layerId !== this.getLayerId()) return;
    this.onDrawn?.();

    event.mapIds?.forEach(mapId => void this.detectBackground(mapId));
  };

  private async detectBackground(mapId: string) {
    if (this.backgroundColors.has(mapId) || this.detecting.has(mapId)) return;

    const warpedMap = this.layer?.getWarpedMap(mapId);
    if (!warpedMap || !warpedMap.hasImage()) return;

    this.detecting.add(mapId);

    try {
      const hexColor = await backgroundColorOf(warpedMap.image, warpedMap.resourceMask);
      this.backgroundColors.set(mapId, hexColor);

      if (this.backgroundRemoved) this.layer?.setMapOptions(mapId, this.removeColorOptions(hexColor, true));

      const layer = this.previewLayers.find(previewLayer => previewLayer.id === this.getLayerId());
      if (layer && !layer.backgroundRemovable) {
        layer.backgroundRemovable = true;
        this.onLayersChanged?.();
      }
    } catch (error) {
      console.warn(`Could not work out the background color of a georeferenced map in ${this.url}:`, error);
    } finally {
      this.detecting.delete(mapId);
    }
  }

  async clearPreview() {
    if (this.attached) (this.map as unknown as WarpedMapEvented).off(FIRST_TILE_EVENT, this.handleFirstTile);
    await super.clearPreview();
    this.layer = undefined;
  }

  protected applyStyleLayerState(styleLayer: PreviewStyleLayer, state: LayerState) {
    super.applyStyleLayerState(styleLayer, state);

    // A rebuilt style may not have attached this layer to a renderer yet.
    if (!this.map.getLayer(styleLayer.id)) return;

    this.applyBackgroundRemoval(state.removeBackground ?? false);
  }

  protected applyOpacity(_styleLayer: PreviewStyleLayer, opacity: number) {
    this.layer?.setOpacity(opacity);
  }

  private applyBackgroundRemoval(remove: boolean) {
    if (remove === this.backgroundRemoved) return;
    this.backgroundRemoved = remove;

    if (!this.backgroundColors.size) return;

    this.layer?.setMapsOptions(mapId => {
      const hexColor = this.backgroundColors.get(mapId);
      return hexColor === undefined ? undefined : this.removeColorOptions(hexColor, remove);
    });
  }

  private removeColorOptions(hexColor: string, remove: boolean) {
    return {
      removeColor: remove,
      removeColorColor: hexColor,
      removeColorHardness: REMOVE_COLOR_HARDNESS,
      removeColorThreshold: remove ? REMOVE_COLOR_THRESHOLD : 0,
    };
  }

  async getBounds(): Promise<LngLatBoundsLike | undefined> {
    return this.layer?.getBounds() ?? (await super.getBounds());
  }
}
