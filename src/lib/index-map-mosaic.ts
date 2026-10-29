import type { MapLibreOverlay as DeckOverlay } from '@deck.gl/maplibre';
import { MosaicLayer } from '@developmentseed/deck.gl-geotiff';
import type { DecoderPool, GeoTIFF } from '@developmentseed/geotiff';
import type { MapLibreMap } from 'maplibre-gl';

import ClippedCOGLayer from './clipped-cog-layer';
import { isScalarSampleFormat, releaseScalarTile, scalarGetTileData, scalarRange, scalarRenderTile, type ScalarRange, type ScalarTileData } from './cog-pipeline';
import { DEFAULT_COLOR_RAMP, type ColorRampName } from './colormap';
import { decoderPool } from './decoder';
import { deckOverlay } from './deck-overlay';
import { openGeoTIFF } from './geotiff';
import { isLayerDrawn, type Layer, type LayerState } from './layers';
import { mosaicMinZoom, mosaicSheets, type MosaicSheet } from './mosaic';
import type { Quantity } from './quantity';
import type OpenIndexMapResource from './resources/openindexmap';
import type { MapLibreStyle } from './themes/maplibre';

const OPEN_SHEETS = 256;

// Without overviews, even a distant view must fetch every full-resolution tile.
const MOST_TILES_WITHOUT_OVERVIEWS = 16;

const GLOBE_PARAMETERS = { depthCompare: 'always' as const, cullMode: 'back' as const };

type SheetData = { geotiff: GeoTIFF; range?: ScalarRange } | null;

type UnloadedTile = { content: unknown };

export type MosaicHost = {
  map: MapLibreMap;
  style: MapLibreStyle;
  beforeId: () => string | undefined;
  layersChanged: () => void;
  notice: (notice: string | undefined) => void;
  loading: (loading: boolean) => void;
};

const isAbort = (error: unknown) => (error as { name?: unknown } | null)?.name === 'AbortError';

const isDrawable = (geotiff: GeoTIFF) => geotiff.isTiled && (geotiff.overviews.length > 0 || geotiff.tileCount.x * geotiff.tileCount.y <= MOST_TILES_WITHOUT_OVERVIEWS);

export default class IndexMapMosaic {
  readonly id: string;

  readonly sheets: MosaicSheet[];
  readonly minZoom: number;

  protected host: MosaicHost | undefined;

  protected deckOverlay: DeckOverlay | undefined;

  protected decoderPool: DecoderPool | undefined;

  protected drawnState: LayerState | undefined;

  protected row: Layer | undefined;

  protected deckLayer: MosaicLayer<MosaicSheet, SheetData> | undefined;
  private loading = false;

  protected valueRange: ScalarRange | undefined;

  protected quantity: Quantity | undefined;

  private opened = new Map<string, Promise<GeoTIFF>>();

  constructor(
    protected resource: OpenIndexMapResource,
    collection: unknown,
  ) {
    this.id = `${resource.id}-mosaic`;
    this.sheets = mosaicSheets(collection);
    this.minZoom = mosaicMinZoom(this.sheets);
  }

  async canDraw(): Promise<boolean> {
    const [first] = this.sheets;
    if (!first) return false;

    try {
      const data = await this.loadSheet(first);
      if (!data) throw new Error(`${first.url} is not a cloud-optimized GeoTIFF.`);

      this.valueRange = data.range;
      if (data.range) void this.readQuantity();
      return true;
    } catch (error) {
      console.warn(`Could not draw a mosaic of ${this.resource.url}:`, error);
      return false;
    }
  }

  createRow(style: MapLibreStyle): Layer {
    this.row = {
      id: this.id,
      title: 'Mosaic',
      defaultOpacity: style.opacity,
      styleLayers: [{ id: this.id, type: 'custom' }],
      ...(this.valueRange && { defaultColorRamp: DEFAULT_COLOR_RAMP, colorRampRange: this.valueRange }),
      ...(this.valueRange && this.quantity && { quantity: this.quantity }),
    };
    return this.row;
  }

  protected async readQuantity() {
    const quantity = await this.resource.getQuantity();
    if (!quantity) return;
    this.quantity = quantity;

    if (!this.row?.colorRampRange || this.row.quantity) return;
    this.row.quantity = quantity;
    this.host?.layersChanged();
  }

  attach(host: MosaicHost): this {
    this.host = host;
    this.deckOverlay = this.getDeckOverlay(host.map);
    this.decoderPool ??= this.createDecoderPool();
    this.drawnState = { visible: true, opacity: host.style.opacity };
    return this;
  }

  draw() {
    this.watchCamera();
    this.drawDeckLayer();
    this.syncNotice();
  }

  applyState(state: LayerState) {
    this.drawnState = state;
    this.drawDeckLayer();
    this.syncNotice();
  }

  clear() {
    this.stopWatching();
    this.deckOverlay?.setProps({ layers: [] });
    this.host?.notice(undefined);
    this.setLoading(false);
    this.host = undefined;
    this.deckLayer = undefined;
  }

  protected drawDeckLayer() {
    const host = this.host;
    if (!host || !this.deckOverlay || !this.drawnState) return;
    this.deckLayer = this.createDeckLayer(host, this.drawnState);
    this.deckOverlay.setProps({ layers: [this.deckLayer] });
    if (!host.map.isStyleLoaded()) this.placeOnceIdle();
  }

  protected createDeckLayer(host: MosaicHost, state: LayerState): MosaicLayer<MosaicSheet, SheetData> {
    const ramp = state.colorRamp ?? DEFAULT_COLOR_RAMP;
    const range = this.valueRange;

    const props = {
      id: this.id,
      sources: this.sheets,
      minZoom: this.minZoom,
      visible: isLayerDrawn(state),
      // Evict offscreen sheet layers; opened headers are cached separately and are cheap to retain.
      maxCacheSize: 0,
      getSource: (sheet: MosaicSheet, { signal }: { signal?: AbortSignal }) => this.loadSheet(sheet, signal),
      renderSource: (sheet: MosaicSheet, { data, signal }: { data?: SheetData; signal?: AbortSignal }) =>
        data ? this.createSheetLayer(sheet, data, state, ramp, range, signal) : null,
      onSourceError: (sheet: MosaicSheet, { error }: { error: Error }) => this.reportSheetError(sheet, error),
      onViewportLoad: (entries: { data?: SheetData }[]) => this.stretchToView(entries),
      beforeId: host.beforeId(),
    };

    return new MosaicLayer<MosaicSheet, SheetData>(props);
  }

  protected createSheetLayer(
    sheet: MosaicSheet,
    data: NonNullable<SheetData>,
    state: LayerState,
    ramp: ColorRampName,
    range: ScalarRange | undefined,
    signal?: AbortSignal,
  ): ClippedCOGLayer | ClippedCOGLayer<ScalarTileData> {
    const shared = {
      id: `${this.id}-${sheet.id}`,
      geotiff: data.geotiff,
      visible: isLayerDrawn(state),
      opacity: state.opacity,
      parameters: GLOBE_PARAMETERS,
      pool: this.decoderPool,
      signal,
      onTileError: (error: unknown) => this.reportTileError(sheet, error),
    };

    const clipped = { cutline: sheet.bbox };
    if (!data.range || !range) return new ClippedCOGLayer({ ...shared, ...clipped });

    return new ClippedCOGLayer<ScalarTileData>({
      ...shared,
      ...clipped,
      getTileData: scalarGetTileData,
      renderTile: scalarRenderTile(ramp, range),
      onTileUnload: (tile: UnloadedTile) => releaseScalarTile(tile.content as ScalarTileData | null),
      updateTriggers: { renderTile: [ramp, ...range] },
    });
  }

  protected async loadSheet(sheet: MosaicSheet, signal?: AbortSignal): Promise<SheetData> {
    let geotiff: GeoTIFF;
    try {
      geotiff = await this.openSheet(sheet.url, signal);
    } catch (error) {
      if (!isAbort(error) || signal?.aborted) throw error;
      geotiff = await this.openSheet(sheet.url, signal);
    }

    if (!isDrawable(geotiff)) return null;
    return { geotiff, range: isScalarSampleFormat(geotiff.cachedTags) ? await scalarRange(geotiff, this.decoderPool) : undefined };
  }

  protected openSheet(url: string, signal?: AbortSignal): Promise<GeoTIFF> {
    const cached = this.opened.get(url);
    if (cached) {
      this.opened.delete(url);
      this.opened.set(url, cached);
      return cached;
    }

    const opening = this.loadGeoTIFF(url, signal).catch(error => {
      if (this.opened.get(url) === opening) this.opened.delete(url);
      throw error;
    });

    this.opened.set(url, opening);
    for (const oldest of this.opened.keys()) {
      if (this.opened.size <= OPEN_SHEETS) break;
      this.opened.delete(oldest);
    }
    return opening;
  }

  protected loadGeoTIFF(url: string, signal?: AbortSignal): Promise<GeoTIFF> {
    return openGeoTIFF(url, this.resource.requestTransform, signal);
  }

  // Use one range across visible sheets so identical values have identical colors.
  protected stretchToView(entries: { data?: SheetData }[]) {
    const ranges = entries.flatMap(({ data }) => (data?.range ? [data.range] : []));
    if (!ranges.length) return;

    const range: ScalarRange = [Math.min(...ranges.map(([min]) => min)), Math.max(...ranges.map(([, max]) => max))];
    if (this.valueRange && range[0] === this.valueRange[0] && range[1] === this.valueRange[1]) return;

    this.valueRange = range;
    if (this.row) this.row.colorRampRange = range;

    this.host?.layersChanged();

    // Defer redraw until deck.gl finishes its update, which would otherwise discard this setProps call.
    queueMicrotask(() => this.drawDeckLayer());
  }

  protected reportSheetError(sheet: MosaicSheet, error: unknown) {
    if (isAbort(error)) return;
    console.warn(`Could not open ${sheet.url} for the mosaic:`, error);
  }

  protected reportTileError(sheet: MosaicSheet, error: unknown) {
    if (isAbort(error)) return;
    console.warn(`Could not draw a tile of ${sheet.url}:`, error);
  }

  protected syncNotice() {
    const host = this.host;
    if (!host) return;
    const tooFar = host.map.getZoom() < this.minZoom && isLayerDrawn(this.drawnState ?? { visible: true, opacity: 1 });
    host.notice(tooFar ? 'Zoom in to see mosaic.' : undefined);
  }

  protected watchCamera() {
    const map = this.host?.map;
    if (!map) return;
    map.off('zoomend', this.handleZoom);
    map.on('zoomend', this.handleZoom);
    map.off('projectiontransition', this.handleProjectionTransition);
    map.on('projectiontransition', this.handleProjectionTransition);
    map.off('render', this.handleRender);
    map.on('render', this.handleRender);
    map.off('remove', this.stopWatching);
    map.once('remove', this.stopWatching);
  }

  protected syncLoading() {
    const drawn = this.drawnState !== undefined && isLayerDrawn(this.drawnState);
    this.setLoading(drawn && this.deckLayer !== undefined && !this.deckLayer.isLoaded);
  }

  private setLoading(loading: boolean) {
    if (loading === this.loading) return;
    this.loading = loading;
    this.host?.loading(loading);
  }

  private stopWatching = () => {
    const map = this.host?.map;
    if (!map) return;
    map.off('zoomend', this.handleZoom);
    map.off('projectiontransition', this.handleProjectionTransition);
    map.off('render', this.handleRender);
    map.off('idle', this.handleIdle);
    map.off('remove', this.stopWatching);
  };

  private handleRender = () => this.syncLoading();

  private handleZoom = () => this.syncNotice();

  private handleProjectionTransition = () => this.drawDeckLayer();

  protected placeOnceIdle() {
    const map = this.host?.map;
    if (!map) return;
    map.off('idle', this.handleIdle);
    map.once('idle', this.handleIdle);
  }

  private handleIdle = () => this.drawDeckLayer();

  protected createDecoderPool(): DecoderPool {
    return decoderPool();
  }

  protected getDeckOverlay(map: MapLibreMap): DeckOverlay {
    return deckOverlay(map);
  }
}
