import type { MapLibreOverlay as DeckOverlay } from '@deck.gl/maplibre';
import { MosaicLayer } from '@developmentseed/deck.gl-geotiff';
import type { DecoderPool, GeoTIFF } from '@developmentseed/geotiff';
import type { MapLibreMap } from 'maplibre-gl';

import ClippedCOGLayer from '../clipped-cog-layer';
import { isScalarSampleFormat, releaseScalarTile, scalarGetTileData, scalarRange, scalarRenderTile, type ScalarRange, type ScalarTileData } from '../cog-pipeline';
import { DEFAULT_COLOR_RAMP, type ColorRampName } from '../colormap';
import { decoderPool } from '../decoder';
import { deckOverlay } from '../deck-overlay';
import { openGeoTIFF } from '../geotiff';
import { isLayerDrawn, type Layer, type LayerState } from '../layers';
import { mosaicMinZoom, mosaicSheets, type MosaicSheet } from '../mosaic';
import type { Quantity } from '../quantity';
import type OpenIndexMapResource from '../resources/openindexmap';
import type { MapLibreStyle } from '../themes/maplibre';

// How many opened sheets to keep. Each holds whatever of its header has been read - a chunk or two of
// 64 KiB - so this is a few megabytes at most, and enough that panning back over a view doesn't read
// every header in it again.
const OPEN_SHEETS = 256;

// How many tiles a GeoTIFF with no overviews can have and still go into a mosaic. Without overviews
// every tile is full resolution, so drawing the sheet at all means reading all of them; a small
// sheet is still cheap to read whole, and a big one isn't.
const MOST_TILES_WITHOUT_OVERVIEWS = 16;

// The same depth and culling CogPreviewer draws with on a globe, for the same reason; see the note on
// `parameters` in CogPreviewer.createDeckLayer
const GLOBE_PARAMETERS = { depthCompare: 'always' as const, cullMode: 'back' as const };

// What a sheet has once it's been opened: the COG, and - for one of floats or signed integers - the
// values it holds, which the whole mosaic's ramp is stretched across. Null for a GeoTIFF that opened
// but can't be drawn as a COG.
type SheetData = { geotiff: GeoTIFF; range?: ScalarRange } | null;

// The tile deck.gl hands to onTileUnload, narrowed to the field read here; see the note on
// UnloadedTile in CogPreviewer for why it's content and not data
type UnloadedTile = { content: unknown };

/**
 * What a mosaic needs of the index map preview it's drawn in. Read through closures rather than
 * copied, since the preview's own hooks are handed to it afresh on every load.
 */
export type MosaicHost = {
  map: MapLibreMap;
  style: MapLibreStyle;
  // The style layer the mosaic goes underneath: the sheets' outlines, so they're still drawn over it
  beforeId: () => string | undefined;
  // The mosaic's row in the panel has changed - its ramp's range, or its title
  layersChanged: () => void;
  // Something to tell the reader about the view, or undefined to stop
  notice: (notice: string | undefined) => void;
  // Whether the mosaic is still drawing what's in view - see MapPreviewer.onLoading
  loading: (loading: boolean) => void;
};

const isAbort = (error: unknown) => (error as { name?: unknown } | null)?.name === 'AbortError';

// Whether a GeoTIFF can be drawn a tile at a time, at the resolution the view needs
const isDrawable = (geotiff: GeoTIFF) => geotiff.isTiled && (geotiff.overviews.length > 0 || geotiff.tileCount.x * geotiff.tileCount.y <= MOST_TILES_WITHOUT_OVERVIEWS);

/**
 * The sheets of an index map that link COGs, drawn as one mosaic - one more layer of the index map's
 * own preview, between the sheets' fills and their outlines, so the outlines are still drawn over it
 * and still answer a click with the sheet.
 *
 * One deck.gl MosaicLayer draws it, which treats each sheet as a tile of its own - opening a sheet only
 * once it's in view, and letting it go once it isn't - and draws each as CogPreviewer draws a single
 * COG, clipped to the sheet's outline; see ClippedCOGLayer.
 *
 * Kept in a module of its own because it's what loads deck.gl: OpenIndexMapPreviewer only asks for it
 * once the index map turns out to link GeoTIFFs. The deck.gl plumbing is CogPreviewer's - the overlay,
 * the projection nudge, the wait for an idle map - repeated rather than shared for now; see that class
 * for why each is needed.
 */
export default class IndexMapMosaic {
  // The mosaic's row in the layers panel, and the style layer it reports
  readonly id: string;

  // The sheets that go into the mosaic, and the zoom below which none of them is opened
  readonly sheets: MosaicSheet[];
  readonly minZoom: number;

  // The preview this is drawn in, between attach and clear
  protected host: MosaicHost | undefined;

  // The overlay deck.gl draws into, shared with any other deck previewer on the same map
  protected deckOverlay: DeckOverlay | undefined;

  // Shared with every COG on the page - see src/lib/decoder.ts
  protected decoderPool: DecoderPool | undefined;

  // What the user has asked for of the mosaic's row, held because deck.gl takes it as props
  protected drawnState: LayerState | undefined;

  // The row as last listed, so a range or a title that arrives late can be written into it
  protected row: Layer | undefined;

  // The MosaicLayer last handed to deck.gl, which deck.gl draws as it is - so asking it whether it has
  // loaded is asking about what's on the map. And what was last said about it; see syncLoading.
  protected deckLayer: MosaicLayer<MosaicSheet, SheetData> | undefined;
  private loading = false;

  // The values the ramp is stretched across, for a mosaic of floats or signed integers. Starts as the
  // first sheet's and follows the sheets in view after that; see stretchToView. Kept across a basemap
  // swap, so the ramp doesn't jump back to the first sheet's range on every theme toggle.
  protected valueRange: ScalarRange | undefined;

  // What the sheets' values measure, if the index map's record says - see OpenIndexMapResource.getQuantity
  protected quantity: Quantity | undefined;

  // Opened sheets, most recently asked for last. Promises rather than GeoTIFFs, so that two asks for a
  // sheet still being opened share the one read.
  private opened = new Map<string, Promise<GeoTIFF>>();

  constructor(
    protected resource: OpenIndexMapResource,
    collection: unknown,
  ) {
    this.id = `${resource.id}-mosaic`;
    this.sheets = mosaicSheets(collection);
    this.minZoom = mosaicMinZoom(this.sheets);
  }

  /**
   * Whether the mosaic can be drawn at all, which is asked before its row is offered: the index map
   * only says its sheets link GeoTIFFs, and a GeoTIFF needn't be a COG. Answered by opening the first
   * sheet, which is one read, and which the mosaic would make anyway once that sheet is in view. The
   * first sheet also decides whether the row has a ramp - a mosaic is of one kind of data.
   */
  async canDraw(): Promise<boolean> {
    const [first] = this.sheets;
    if (!first) return false;

    try {
      const data = await this.loadSheet(first);
      if (!data) throw new Error(`${first.url} is not a cloud-optimized GeoTIFF.`);

      this.valueRange = data.range;
      // Not awaited, as CogPreviewer doesn't: the legend can take its title late
      if (data.range) void this.readQuantity();
      return true;
    } catch (error) {
      console.warn(`Could not draw a mosaic of ${this.resource.url}:`, error);
      return false;
    }
  }

  /**
   * The mosaic's row in the layers panel. Built afresh for every draw of the preview, since every draw
   * starts its list over, and from what's known by then - so a basemap swap keeps the stretched range
   * and the title rather than going back to the first sheet's.
   */
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

  // Title the legend by what the values measure, as CogPreviewer does for one COG - from the index map's
  // record rather than from any one sheet, which the index map only names. Late if it's late: the row is
  // built without it and told about it once it's here.
  protected async readQuantity() {
    const quantity = await this.resource.getQuantity();
    if (!quantity) return;
    this.quantity = quantity;

    if (!this.row?.colorRampRange || this.row.quantity) return;
    this.row.quantity = quantity;
    this.host?.layersChanged();
  }

  // Bind the mosaic to the preview it's drawn in, until clear
  attach(host: MosaicHost): this {
    this.host = host;
    this.deckOverlay = this.getDeckOverlay(host.map);
    this.decoderPool ??= this.createDecoderPool();
    this.drawnState = { visible: true, opacity: host.style.opacity };
    return this;
  }

  // Put the mosaic on the map, and start watching the camera for what to say about it
  draw() {
    this.watchCamera();
    this.drawDeckLayer();
    this.syncNotice();
  }

  // What the user has asked for of the mosaic's row
  applyState(state: LayerState) {
    this.drawnState = state;
    this.drawDeckLayer();
    this.syncNotice();
  }

  // Take the mosaic off the map. The sheets already opened are kept, for the next time it's drawn.
  clear() {
    this.stopWatching();
    this.deckOverlay?.setProps({ layers: [] });
    this.host?.notice(undefined);
    this.setLoading(false);
    this.host = undefined;
    this.deckLayer = undefined;
  }

  // Hand deck.gl the mosaic as it should now be drawn. Rebuilt rather than mutated, as CogPreviewer's
  // layer is; deck.gl matches it by id, so the sheets already open and the tiles already decoded are kept.
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
      // Each sheet is a full COGLayer, with a tile cache and textures of its own, and the headers that
      // are cheap to keep are already kept in `opened` - so a sheet out of view is let go entirely, as
      // upstream's NAIP example does
      maxCacheSize: 0,
      getSource: (sheet: MosaicSheet, { signal }: { signal?: AbortSignal }) => this.loadSheet(sheet, signal),
      renderSource: (sheet: MosaicSheet, { data, signal }: { data?: SheetData; signal?: AbortSignal }) =>
        data ? this.createSheetLayer(sheet, data, state, ramp, range, signal) : null,
      onSourceError: (sheet: MosaicSheet, { error }: { error: Error }) => this.reportSheetError(sheet, error),
      onViewportLoad: (entries: { data?: SheetData }[]) => this.stretchToView(entries),
      // Not one of deck.gl's own props - @deck.gl/maplibre reads it off them - which is why these are
      // gathered here rather than written into the call, as CogPreviewer gathers its own
      beforeId: host.beforeId(),
    };

    return new MosaicLayer<MosaicSheet, SheetData>(props);
  }

  // One sheet of the mosaic, drawn just as CogPreviewer draws a COG on its own - minus the bounds and
  // drawing reports, which the outlines already give.
  //
  // Opacity and visibility are both the sheet's own, rather than left to the mosaic: MosaicLayer hands
  // neither down. deck.gl does skip drawing a layer whose parent is hidden, but it can't be relied on
  // to know which layer that is. A sheet is rebuilt on every change to the mosaic, and its tiles are
  // only redrawn - and only then told who their parent is now - if a prop deck.gl compares has changed;
  // function props aren't compared. A DEM's tiles are redrawn anyway, since its ramp hands it a new
  // renderTile each time, but a scan's aren't, so they went on answering to the mosaic as it was before
  // it was hidden, and went on being drawn.
  //
  // Every sheet is clipped to its outline, which is the part of it the index map says is the sheet's.
  // A scanned map, as HTMC's are, has a margin around the map - the collar, with its title, scale and
  // credits - that would otherwise be drawn over the edges of every sheet around it. A DEM tile has no
  // collar, but 3DEP's run a few pixels past their degree on every side, and below full opacity the
  // strip two neighbours share is drawn twice, as a darker band along every seam.
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

    // Spread in rather than written in, the way CogPreviewer hands over beforeId: COGLayer's props
    // don't know of it, and ClippedCOGLayer reads it off its props itself
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

  /**
   * Open a sheet and say what's in it: null for a GeoTIFF that can't be drawn a tile at a time. Read
   * again once if the read was abandoned on behalf of someone else: two asks for one sheet share its
   * read, and a sheet that leaves the view and comes straight back can find the read it joined
   * cancelled by its own earlier departure.
   */
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

  // The opened sheet, from the cache or read now. One that fails is dropped, so it's read afresh the
  // next time it's in view rather than failing for good.
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

  // Through the resource's request transform, as CogPreviewer opens its COG. A method of its own so a
  // test can hand over a GeoTIFF instead.
  protected loadGeoTIFF(url: string, signal?: AbortSignal): Promise<GeoTIFF> {
    return openGeoTIFF(url, this.resource.requestTransform, signal);
  }

  /**
   * Stretch the ramp across the sheets in view, once they've all been opened.
   *
   * One range for the whole mosaic, rather than each sheet's own: stretched separately, two DEM tiles
   * meeting at a ridge would each draw it in a different colour, and the seam between them would be
   * the most visible thing on the map. The sheets in view rather than every sheet, because an index
   * map can span a continent - one ramp across Death Valley and Denali leaves both featureless - and
   * because the sheets in view are the only ones that have been opened.
   */
  protected stretchToView(entries: { data?: SheetData }[]) {
    const ranges = entries.flatMap(({ data }) => (data?.range ? [data.range] : []));
    if (!ranges.length) return;

    const range: ScalarRange = [Math.min(...ranges.map(([min]) => min)), Math.max(...ranges.map(([, max]) => max))];
    if (this.valueRange && range[0] === this.valueRange[0] && range[1] === this.valueRange[1]) return;

    this.valueRange = range;
    if (this.row) this.row.colorRampRange = range;

    this.host?.layersChanged();

    // Not drawn from here: this is called from inside deck.gl's own update of the layers, and a
    // setProps made then is lost - LayerManager.updateLayers clears the layers it was handed meanwhile
    // as soon as the update that called us returns. The legend would show the new range while every
    // sheet kept drawing with the old one.
    queueMicrotask(() => this.drawDeckLayer());
  }

  // A sheet that won't open is a hole in the mosaic, not a failed preview: the outlines are drawn and
  // every other sheet still can be
  protected reportSheetError(sheet: MosaicSheet, error: unknown) {
    if (isAbort(error)) return;
    console.warn(`Could not open ${sheet.url} for the mosaic:`, error);
  }

  // Likewise a tile of one, which overriding also keeps from deck.gl's own handler logging every one
  protected reportTileError(sheet: MosaicSheet, error: unknown) {
    if (isAbort(error)) return;
    console.warn(`Could not draw a tile of ${sheet.url}:`, error);
  }

  // Say why the mosaic isn't drawn, when it's because the view is too far out for it to be
  protected syncNotice() {
    const host = this.host;
    if (!host) return;
    const tooFar = host.map.getZoom() < this.minZoom && isLayerDrawn(this.drawnState ?? { visible: true, opacity: 1 });
    host.notice(tooFar ? 'Zoom in to see mosaic.' : undefined);
  }

  // Taken off first, so a theme change - which draws the preview again with no clear between - leaves
  // one listener rather than two. The projection watch is CogPreviewer's; see watchProjection.
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

  /**
   * Say whether the sheets in view are still on their way, so the reader can be shown the map is
   * still loading rather than left to pan off before it has finished.
   *
   * Asked of deck.gl after every frame the map draws, which is what deck.gl draws with: a tile arriving
   * asks for a frame, so the last one to arrive is followed by a frame that finds everything in. The
   * MosaicLayer has loaded once every sheet in view has been opened and every one of its tiles in view
   * has arrived - deck.gl's TileLayer counts a tile as loaded only once the layers it drew have, all
   * the way down. A sheet that failed to open counts as done, so one bad sheet can't hold the spinner.
   *
   * Nothing is loading while the mosaic is switched off, or zoomed out past its floor, where no sheet
   * is asked for at all.
   */
  protected syncLoading() {
    const drawn = this.drawnState !== undefined && isLayerDrawn(this.drawnState);
    this.setLoading(drawn && this.deckLayer !== undefined && !this.deckLayer.isLoaded);
  }

  // Once each way per wait, however many frames say the same thing
  private setLoading(loading: boolean) {
    if (loading === this.loading) return;
    this.loading = loading;
    this.host?.loading(loading);
  }

  // Bound instance properties rather than methods, so off() has the same function to remove that on() was given
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

  // Hand deck.gl the mosaic again once the map has settled, so it ends up under the outlines after all;
  // see CogPreviewer.placeOnceIdle
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

  // The overlay every deck previewer on this map draws into; see src/lib/deck-overlay.ts. A method of
  // its own so a test can hand over an overlay instead.
  protected getDeckOverlay(map: MapLibreMap): DeckOverlay {
    return deckOverlay(map);
  }
}
