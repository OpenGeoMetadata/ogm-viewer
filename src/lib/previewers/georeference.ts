import type { AddLayerObject, CustomLayerInterface, Evented, LngLatBoundsLike } from 'maplibre-gl';
import { WarpedMapLayer } from '@allmaps/maplibre';

import MapPreviewer from './map';
import { backgroundColorOf } from '../background-color';
import type IIIFManifestResource from '../resources/iiif-manifest';
import type { GeoreferenceAnnotation } from '../resources/georeference';
import type { LayerState, PreviewStyleLayer } from '../layers';

const FIRST_TILE_EVENT = 'firstmaptileloaded';

// Allmaps fetches tiles in workers MapLibre cannot see, but it does publish events
const TILES_LOADING_EVENT = 'requestedtilesloading';
const TILES_LOADED_EVENT = 'allrequestedtilesloaded';
const IMAGE_INFO_ERROR_EVENT = 'imageinfofetcherror';

type WarpedMapLayerEvent = { type: string; layerId?: string; mapIds?: string[] };

type WarpedMapEventType = typeof FIRST_TILE_EVENT | typeof TILES_LOADING_EVENT | typeof TILES_LOADED_EVENT | typeof IMAGE_INFO_ERROR_EVENT;

type WarpedMapEvented = Evented<Record<WarpedMapEventType, WarpedMapLayerEvent>>;

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

  // Pending while the pages of a long series are still arriving.
  private pages: Promise<void> | undefined;

  private tilesLoading = false;

  private loadingReported = false;

  label() {
    return 'Georeferenced content';
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

  // Attach the layer first; Allmaps creates the renderer that accepts annotations in onAdd. A long series arrives a
  // page at a time, so maps are drawn as they come and the preview counts as started once the first one is on the map.
  async preview(): Promise<void> {
    await super.preview();

    const layer = this.layer;
    if (!layer) return;
    this.watchLayerEvents();

    let found = 0;
    let drawable = 0;
    const errors: unknown[] = [];
    let firstMapAdded = () => {};
    const firstMap = new Promise<void>(resolve => (firstMapAdded = resolve));

    const draw = (annotation: GeoreferenceAnnotation) => {
      found++;

      // Allmaps returns per-map failures; usable maps in the same annotation should still render.
      layer.addGeoreferenceAnnotation(annotation).forEach(result => {
        if (result.ok === false) {
          errors.push(result.error);
          console.warn(`Could not read a georeferenced map in ${this.url}:`, result.error);
        } else drawable++;
      });

      if (drawable) firstMapAdded();
    };

    const pages = (async () => {
      for await (const annotation of this.resource.georeferenceAnnotations()) {
        // A style rebuild or a cleared preview has replaced the layer these maps were meant for.
        if (this.layer !== layer) return;
        draw(annotation);
      }

      if (!found) throw new Error('This manifest has no georeference annotation to draw.');
      if (!drawable) throw errors[0] ?? new Error('The georeference annotation described no maps that could be drawn.');
    })().finally(() => {
      if (this.pages !== pages) return;
      this.pages = undefined;
      this.settleNextFrame();
    });

    this.pages = pages;
    this.tilesLoading = false;
    // The map resets its own loading state before every preview, including a rebuild that reuses this previewer.
    this.loadingReported = false;
    this.reportLoading(true);

    await Promise.race([firstMap, pages]);

    // Failing outright means nothing was drawable, which settles the race above; anything later is only worth a note.
    pages.catch(error => console.warn(`Could not finish reading the georeferenced maps in ${this.url}:`, error));
  }

  // Remove the previous listeners because a style rebuild reuses the previewer without clearing it.
  protected watchLayerEvents() {
    this.unwatchLayerEvents();
    const events = this.map as unknown as WarpedMapEvented;
    events.on(FIRST_TILE_EVENT, this.handleFirstTile);
    events.on(TILES_LOADING_EVENT, this.handleTilesLoading);
    events.on(TILES_LOADED_EVENT, this.handleTilesLoaded);
    events.on(IMAGE_INFO_ERROR_EVENT, this.handleImageInfoError);
    this.map.on('render', this.settleLoading);
    this.map.on('moveend', this.handleMoveEnd);
  }

  private unwatchLayerEvents() {
    const events = this.map as unknown as WarpedMapEvented;
    events.off(FIRST_TILE_EVENT, this.handleFirstTile);
    events.off(TILES_LOADING_EVENT, this.handleTilesLoading);
    events.off(TILES_LOADED_EVENT, this.handleTilesLoaded);
    events.off(IMAGE_INFO_ERROR_EVENT, this.handleImageInfoError);
    this.map.off('render', this.settleLoading);
    this.map.off('moveend', this.handleMoveEnd);
  }

  private handleMoveEnd = () => {
    const renderer = this.layer?.renderer;
    if (!renderer) return;
    renderer.previousSignificantViewport = undefined;
    this.map.triggerRepaint();
  };

  private handleTilesLoading = (event: WarpedMapLayerEvent) => {
    if (event.layerId !== this.getLayerId()) return;
    this.tilesLoading = true;
    this.reportLoading(true);
  };

  private handleTilesLoaded = (event: WarpedMapLayerEvent) => {
    if (event.layerId !== this.getLayerId()) return;
    this.tilesLoading = false;
    this.settleNextFrame();
  };

  private handleImageInfoError = (event: WarpedMapLayerEvent) => {
    if (event.layerId === this.getLayerId()) this.settleNextFrame();
  };

  private settleNextFrame() {
    if (this.loadingReported) this.map.triggerRepaint();
  }

  private settleLoading = () => {
    if (!this.loadingReported || this.pages || this.tilesLoading || this.fetchingImageInfo()) return;
    this.reportLoading(false);
  };

  private fetchingImageInfo(): boolean {
    if (!this.layer?.renderer) return false;
    return this.layer.getWarpedMaps().some(warpedMap => warpedMap.fetchingImageInfo);
  }

  private reportLoading(loading: boolean) {
    if (loading === this.loadingReported) return;
    this.loadingReported = loading;
    this.onLoading?.(loading);
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
    if (this.attached) this.unwatchLayerEvents();
    this.reportLoading(false);
    await super.clearPreview();
    this.layer = undefined;
    this.pages = undefined;
    this.tilesLoading = false;
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

  // Fit to every map once they've all loaded
  async getBounds(): Promise<LngLatBoundsLike | undefined> {
    await this.pages?.catch(() => {});
    return this.layer?.getBounds() ?? (await super.getBounds());
  }
}
