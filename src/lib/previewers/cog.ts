import type { MapLibreOverlay as DeckOverlay } from '@deck.gl/maplibre';
import { COGLayer } from '@developmentseed/deck.gl-geotiff';
import type { DecoderPool, GeoTIFF } from '@developmentseed/geotiff';
import type { AddLayerObject, LngLatBoundsLike, MapLibreMap } from 'maplibre-gl';

import MapPreviewer from './map';
import { isScalarSampleFormat, releaseScalarTile, scalarGetTileData, scalarRange, scalarRenderTile, type ScalarRange, type ScalarTileData } from '../cog-pipeline';
import type CogResource from '../resources/cog';
import { DEFAULT_COLOR_RAMP } from '../colormap';
import { decoderPool } from '../decoder';
import { deckOverlay } from '../deck-overlay';
import { openGeoTIFF } from '../geotiff';
import { isLayerDrawn, type LayerState, type PreviewStyleLayer } from '../layers';
import type { Quantity } from '../quantity';
import type { MapLibreStyle } from '../themes/maplibre';

const HEADER_TIMEOUT = 10_000;

type UnloadedTile = { content: unknown };

export default class CogPreviewer extends MapPreviewer {
  declare protected resource: CogResource;

  readonly reportsDrawing = true;

  protected deckOverlay: DeckOverlay | undefined;

  protected decoderPool: DecoderPool | undefined;

  protected drawnState: LayerState | undefined;

  protected geotiffBoundsLoaded: Promise<LngLatBoundsLike | undefined> | undefined;
  private resolveGeotiffBounds: (bounds: LngLatBoundsLike | undefined) => void = () => {};

  protected geotiff: GeoTIFF | undefined;

  protected valueRange: ScalarRange | undefined;

  protected quantity: Quantity | undefined;

  protected anyTileDrawn = false;

  protected deckLayer: COGLayer | COGLayer<ScalarTileData> | undefined;
  private loading = false;

  attach(map: MapLibreMap, style: MapLibreStyle): this {
    super.attach(map, style);
    this.deckOverlay = this.getDeckOverlay();
    this.decoderPool ??= this.createDecoderPool();
    this.drawnState = { visible: true, opacity: style.opacity };
    this.geotiffBoundsLoaded = new Promise(resolve => (this.resolveGeotiffBounds = resolve));
    this.anyTileDrawn = false;
    this.watchProjection();
    this.watchLoading();
    return this;
  }

  // deck.gl does not listen for projectiontransition; reapply its props to update the viewport.
  protected watchProjection() {
    this.map.off('projectiontransition', this.handleProjectionTransition);
    this.map.on('projectiontransition', this.handleProjectionTransition);
    this.map.off('remove', this.stopWatchingProjection);
    this.map.once('remove', this.stopWatchingProjection);
  }

  private stopWatchingProjection = () => {
    if (!this.attached) return;
    this.map.off('projectiontransition', this.handleProjectionTransition);
    this.map.off('remove', this.stopWatchingProjection);
  };

  private handleProjectionTransition = () => {
    this.drawDeckLayer();
  };

  protected syncLoading() {
    const drawn = this.drawnState !== undefined && isLayerDrawn(this.drawnState);
    this.setLoading(drawn && this.deckLayer !== undefined && !this.deckLayer.isLoaded);
  }

  private setLoading(loading: boolean) {
    if (loading === this.loading) return;
    this.loading = loading;
    this.onLoading?.(loading);
  }

  protected watchLoading() {
    this.map.off('render', this.handleRender);
    this.map.on('render', this.handleRender);
    this.map.off('remove', this.stopWatchingLoading);
    this.map.once('remove', this.stopWatchingLoading);
  }

  private stopWatchingLoading = () => {
    if (!this.attached) return;
    this.map.off('render', this.handleRender);
    this.map.off('remove', this.stopWatchingLoading);
  };

  private handleRender = () => this.syncLoading();

  protected async createSources(): Promise<[]> {
    return [];
  }

  protected async createLayers(): Promise<AddLayerObject[]> {
    this.previewLayers.push({
      id: this.getLayerId(),
      title: this.resource.label(),
      defaultOpacity: this.style.opacity,
      styleLayers: [{ id: this.getLayerId(), type: 'custom' }],
      ...(this.valueRange && { defaultColorRamp: DEFAULT_COLOR_RAMP, colorRampRange: this.valueRange }),
      ...(this.valueRange && this.quantity && { quantity: this.quantity }),
    });

    return [];
  }

  protected getLayerId(): string {
    return `${this.resource.id}-cog`;
  }

  // Read the scalar range before createLayers publishes the ramp defaults.
  async preview(): Promise<void> {
    void this.readQuantity();

    this.geotiff = await this.loadGeoTIFF();
    this.valueRange = isScalarSampleFormat(this.geotiff.cachedTags) ? await scalarRange(this.geotiff, this.decoderPool) : undefined;
    await super.preview();
    this.drawDeckLayer();
  }

  protected async readQuantity() {
    const quantity = await this.resource.getQuantity();
    if (!quantity) return;
    this.quantity = quantity;

    const layer = this.previewLayers.find(previewLayer => previewLayer.id === this.getLayerId());
    if (!layer?.colorRampRange || layer.quantity) return;
    layer.quantity = quantity;
    this.onLayersChanged?.();
  }

  protected async loadGeoTIFF(): Promise<GeoTIFF> {
    return await openGeoTIFF(this.resource.url, this.requestTransform);
  }

  async clearPreview() {
    this.stopWatchingProjection();
    this.stopWatchingLoading();
    this.setLoading(false);
    if (this.attached) this.map.off('idle', this.handleIdle);
    await super.clearPreview();
    this.deckOverlay?.setProps({ layers: [] });
    this.deckLayer = undefined;
    this.geotiff = undefined;
    this.valueRange = undefined;
  }

  protected applyStyleLayerState(_styleLayer: PreviewStyleLayer, state: LayerState) {
    this.drawnState = state;
    this.drawDeckLayer();
  }

  protected drawDeckLayer() {
    if (!this.deckOverlay || !this.drawnState || !this.geotiff) return;
    this.deckLayer = this.createDeckLayer(this.geotiff, this.drawnState);
    this.deckOverlay.setProps({ layers: [this.deckLayer] });
    if (!this.map.isStyleLoaded()) this.placeOnceIdle();
  }

  // deck.gl only honors beforeId once the basemap is fully loaded, so place the layer again on idle.
  protected placeOnceIdle() {
    this.map.off('idle', this.handleIdle);
    this.map.once('idle', this.handleIdle);
  }

  private handleIdle = () => {
    this.drawDeckLayer();
  };

  protected createDeckLayer(geotiff: GeoTIFF, state: LayerState): COGLayer | COGLayer<ScalarTileData> {
    const range = this.valueRange;

    const shared = {
      id: this.getLayerId(),
      geotiff,
      visible: isLayerDrawn(state),
      opacity: state.opacity,
      onGeoTIFFLoad: (_data: GeoTIFF, options: { geographicBounds: { west: number; south: number; east: number; north: number } }) => {
        const { west, south, east, north } = options.geographicBounds;
        this.resolveGeotiffBounds([
          [west, south],
          [east, north],
        ]);
      },
      onTileLoad: () => this.reportTileDrawn(),
      onTileError: (error: unknown) => this.reportTileError(error),
      // Skip shared globe depth testing to avoid z-fighting; back-face culling hides the far hemisphere.
      parameters: { depthCompare: 'always' as const, cullMode: 'back' as const },
      pool: this.decoderPool,
      beforeId: this.resolvedBeforeId,
    };

    if (!range) return new COGLayer({ ...shared });

    const ramp = state.colorRamp ?? DEFAULT_COLOR_RAMP;
    return new COGLayer<ScalarTileData>({
      ...shared,
      getTileData: scalarGetTileData,
      renderTile: scalarRenderTile(ramp, range),
      onTileUnload: (tile: UnloadedTile) => releaseScalarTile(tile.content as ScalarTileData | null),
      // Invalidate rendering when the ramp changes while retaining fetched and decoded tiles.
      updateTriggers: { renderTile: [ramp, ...range] },
    });
  }

  protected reportTileDrawn() {
    this.anyTileDrawn = true;
    this.onDrawn?.();
  }

  // Only report failure before any tile draws; later tile errors leave a usable, potentially sparse map.
  protected reportTileError(error: unknown) {
    if ((error as { name?: unknown } | null)?.name === 'AbortError') return;

    if (this.anyTileDrawn) {
      console.warn(`Could not draw a tile of ${this.url}:`, error);
      return;
    }

    console.error(`Error drawing ${this.url}:`, error);
    this.onError?.(error);
  }

  protected createDecoderPool(): DecoderPool {
    return decoderPool();
  }

  async getBounds(): Promise<LngLatBoundsLike | undefined> {
    return (await super.getBounds()) ?? (await this.getReportedBounds());
  }

  async getReportedBounds(): Promise<LngLatBoundsLike | undefined> {
    const timeout = new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), HEADER_TIMEOUT));
    return await Promise.race([this.geotiffBoundsLoaded ?? timeout, timeout]);
  }

  protected getDeckOverlay(): DeckOverlay {
    return deckOverlay(this.map);
  }
}
