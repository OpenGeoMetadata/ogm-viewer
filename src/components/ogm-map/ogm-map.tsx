import { Component, Element, Event, EventEmitter, h, Host, Listen, Method, Prop, State, Watch } from '@stencil/core';
import {
  FullscreenControl,
  NavigationControl,
  Popup,
  type EaseToOptions,
  type ErrorEvent,
  type LngLatBoundsLike,
  type LngLatLike,
  type MapGeoJSONFeature,
  type MapLibreMap,
  type MapMouseEvent,
  type MapSourceDataEvent,
  type Point,
  type Tile,
} from 'maplibre-gl';

import '@awesome.me/webawesome/dist/components/callout/callout.js';

import { closestAcrossShadows, findElement, getElement } from '../../lib/elements';
import { referenceError, TimeoutError, type PreviewError, isWebGLError, WebGLUnavailableError } from '../../lib/errors';
import GlobeControl from '../../lib/globe-control';
import { adoptWebAwesomeTheme, initialTheme, waScope } from '../../lib/init';
import { dedupeFeatures, identified } from '../../lib/features';
import { boundsOverlap, boundsToBbox, mercatorBbox, readBounds, type PixelWindow } from '../../lib/geometry';
import { createMap, fitBounds, openingCamera, setBasemap, whenSized } from '../../lib/maps';
import { isLayerDrawn, rampedLayers, resolveLayerState, timedLayers, toLayerControlItems as getLayerControls, type LayerControl, type LayerState } from '../../lib/layers';
import LayersControl from '../../lib/layers-control';
import { imageLegends } from '../../lib/legend';
import InspectableRasterPreviewer from '../../lib/previewers/inspectable-raster';
import type MapPreviewer from '../../lib/previewers/map';
import type { References } from '../../lib/references';
import { ourResourceType, toMapLibreRequest } from '../../lib/request';
import MapLibreTheme from '../../lib/themes/maplibre';

// Use a small window around the click; the full viewport may be rotated, pitched, or spherical.
const QUERY_WINDOW = 51;

// Restore this floor explicitly; MapLibre treats an absent minimum as -2.
const MIN_ZOOM = 1;

const BASEMAP_GRACE = 250;

const NO_BASEMAP = 'The basemap could not be loaded.';

const MISPLACED_BOUNDS = 'This record’s bounding box doesn’t overlap the data, so the map shows the data’s own extent instead.';

const describeBounds = (bounds: LngLatBoundsLike): string => {
  const read = readBounds(bounds);
  return read ? boundsToBbox(read).join(', ') : JSON.stringify(bounds);
};

const tileZoom = (tile: Tile): number => tile.tileID.canonical.z;

@Component({
  tag: 'ogm-map',
  styleUrl: 'ogm-map.css',
  shadow: true,
})
export class OgmMap {
  @Element() el!: HTMLElement;
  @Prop() previewer: MapPreviewer;
  @Prop() theme: 'light' | 'dark' = initialTheme(this.el);
  @Prop() darkBasemap?: string;
  @Prop() lightBasemap?: string;
  @Prop() padding: number = 0;

  /** Require a modifier for scrolling and two fingers for touch dragging. */
  @Prop() cooperativeGestures: boolean = true;
  @Prop() references?: References;

  @Event() mapIdle: EventEmitter<void>;
  @Event() mapLoading: EventEmitter<void>;
  @Event() previewError: EventEmitter<PreviewError>;

  @State() layerControls: LayerControl[] = [];
  @State() layersPanelOpen: boolean = false;

  @State() notice?: string;
  @State() boundsNotice?: string;
  @State() basemapNotice?: string;
  @State() failedBasemap?: string;

  @State() zoom?: number;

  @State() legendOpen: boolean = true;
  protected layersControl: LayersControl;
  private layerState = new Map<string, LayerState>();

  protected globeControl = new GlobeControl();

  private mapStyleLoaded: boolean = false;

  private basemapFellBack: boolean = false;

  private errorReported: boolean = false;

  private loadDeadline: ReturnType<typeof setTimeout> | undefined = undefined;
  private previewDrawn: boolean = false;

  // Balance loading/idle events once per loading period, regardless of the number of tiles.
  private tilesLoading: boolean = false;
  private previewLoading: boolean = false;

  private previewSettled: Promise<void> = Promise.resolve();
  private settlePreview: () => void = () => {};

  protected map: MapLibreMap;
  protected mapTheme: MapLibreTheme;
  protected popup: Popup | undefined = undefined;
  protected popupResize: ResizeObserver | undefined = undefined;
  protected attributesEl: HTMLOgmAttributesElement;
  protected hoveredFeature: MapGeoJSONFeature | undefined = undefined;
  protected selectedFeature: MapGeoJSONFeature | undefined = undefined;

  componentWillLoad() {
    adoptWebAwesomeTheme(this.el);
  }

  async componentDidLoad() {
    const scope = getElement(this.el, '.container');
    this.mapTheme = new MapLibreTheme(scope, this.theme, { darkBasemap: this.darkBasemap, lightBasemap: this.lightBasemap });

    this.attributesEl = document.createElement('ogm-attributes') as HTMLOgmAttributesElement;
    this.attributesEl.features = [];

    const container = getElement(this.el, '#map');
    await whenSized(container);

    if (!this.el.isConnected) return;

    try {
      this.map = createMap(container, this.mapTheme, {
        minZoom: MIN_ZOOM,
        cooperativeGestures: this.cooperativeGestures,
        // Read the current previewer on each request so changing previews also changes authentication.
        transformRequest: (url, resourceType) => toMapLibreRequest(this.previewer?.requestTransform?.(url, ourResourceType(resourceType)), url),
        ...openingCamera(container, this.mapTheme, this.previewer?.declaredBounds),
      });
    } catch (error) {
      if (!isWebGLError(error)) throw error;

      this.previewError.emit(new WebGLUnavailableError());
      return;
    }

    this.map.on('load', () => this.loadPreview());
    this.map.on('mousemove', this.handleHover.bind(this));
    this.map.on('click', this.handleClick.bind(this));
    this.map.on('error', this.handleMapError.bind(this));
    this.map.on('sourcedata', this.handleSourceData.bind(this));
    this.map.on('sourcedataloading', this.handleSourceDataLoading.bind(this));
    this.map.on('idle', this.settleTileLoading.bind(this));
    this.map.on('zoomend', () => (this.zoom = this.map.getZoom()));
    this.zoom = this.map.getZoom();
    this.addControls();

    this.map.on('style.load', () => {
      this.mapStyleLoaded = true;
      this.applyViewConstraints();
      this.map.setSky(this.mapTheme.getSkyStyle());
    });
  }

  // Close the popup before removing the map so inspection cleanup can still use it.
  disconnectedCallback() {
    this.clearLoadDeadline();
    this.destroyPopup();

    this.settleTileLoading();
    this.setPreviewLoading(false);
    if (this.map) this.map.remove();
  }

  protected getContainer(): HTMLElement {
    const viewerEl = closestAcrossShadows(this.el, 'ogm-viewer');
    return (viewerEl && findElement(viewerEl, '.container')) ?? this.el;
  }

  protected addControls() {
    this.map.addControl(
      new NavigationControl({
        visualizePitch: true,
      }),
    );
    this.layersControl = new LayersControl(this.toggleLayersPanel.bind(this));
    this.map.addControl(this.layersControl);
    this.map.addControl(
      new FullscreenControl({
        container: this.getContainer(),
      }),
    );
    this.map.addControl(this.globeControl);
  }

  @Watch('previewer')
  async onPreviewerChange(_previewer: MapPreviewer, previous?: MapPreviewer) {
    if (previous) await previous.clearPreview();
    await this.loadPreview();
  }

  async loadPreview() {
    if (!this.previewer || !this.map) return;

    if (!this.mapStyleLoaded) return;

    this.errorReported = false;
    this.clearLoadDeadline();
    this.previewDrawn = false;
    this.notice = undefined;
    this.boundsNotice = undefined;
    this.setPreviewLoading(false);

    this.mapLoading.emit();

    this.layerControls = [];
    this.layerState.clear();
    this.layersPanelOpen = false;
    this.layersControl.setPressed(false);

    this.destroyPopup();

    this.applyViewConstraints();

    // Custom WebGL previews report drawing and errors themselves because they have no MapLibre source.
    const previewer = this.previewer;
    previewer.onError = error => {
      if (this.previewer === previewer) this.reportError(error);
    };
    previewer.onDrawn = () => {
      if (this.previewer === previewer) this.markPreviewDrawn();
    };
    previewer.onNotice = notice => {
      if (this.previewer === previewer) this.notice = notice;
    };
    previewer.onLoading = loading => {
      if (this.previewer === previewer) this.setPreviewLoading(loading);
    };
    previewer.onLayersChanged = () => {
      if (this.previewer === previewer) this.setupLayerControls();
    };

    try {
      this.previewer.attach(this.map, this.mapTheme.getStyle());
      await this.previewer.preview();

      this.applyViewConstraints();

      // Start waiting before fitting bounds, which can trigger the first tile request.
      this.startLoadDeadline();
      const settled = this.previewSettled;

      this.applyLayerState();
      this.setupLayerControls();

      const bounds = await this.previewer.getBounds();
      if (bounds) await this.fitMapBounds(bounds);

      await this.fitToReportedBounds(previewer);

      await settled;
    } catch (error) {
      console.error(`Error previewing ${this.previewer.url}:`, error);
      this.reportError(error);
    } finally {
      this.mapIdle.emit();
    }
  }

  @Watch('theme')
  @Watch('darkBasemap')
  @Watch('lightBasemap')
  async onThemeChange() {
    if (!this.map) return;
    this.mapTheme.theme = this.theme;
    this.mapTheme.darkBasemap = this.darkBasemap;
    this.mapTheme.lightBasemap = this.lightBasemap;
    this.destroyPopup();
    this.mapStyleLoaded = false;
    this.basemapFellBack = false;
    this.basemapNotice = undefined;
    this.failedBasemap = undefined;
    await setBasemap(this.map, this.mapTheme);
    await this.loadPreview();
  }

  @Watch('cooperativeGestures')
  onCooperativeGesturesChange() {
    if (!this.map) return;
    if (this.cooperativeGestures) this.map.cooperativeGestures.enable();
    else this.map.cooperativeGestures.disable();
  }

  protected handleMapError(event: ErrorEvent & { sourceId?: string; tile?: Tile }) {
    if (!this.mapStyleLoaded) return this.confirmBasemapFailure();

    if (this.tilesLoading) this.map.triggerRepaint();

    const sourceId = event.sourceId ?? '';
    if (!this.previewer?.sourceIds.includes(sourceId)) return;

    if (event.tile && this.previewer.absorbTileError(sourceId, tileZoom(event.tile))) return;

    if (event.tile && this.previewDrawn) {
      console.warn(`Could not load a tile of ${this.previewer.url}:`, event.error);
      return;
    }

    if (this.errorReported) return;
    this.reportError(event.error);
  }

  // Allow style.load to arrive before treating an early sprite or glyph error as a basemap failure.
  protected confirmBasemapFailure() {
    if (this.basemapFellBack) return;
    this.basemapFellBack = true;

    setTimeout(() => {
      if (this.mapStyleLoaded || !this.map || !this.el.isConnected) return;
      this.fallBackToEmptyBasemap();
    }, BASEMAP_GRACE);
  }

  // An empty style lets the preview render when the basemap never fires style.load.
  protected fallBackToEmptyBasemap() {
    this.basemapNotice = NO_BASEMAP;
    this.failedBasemap = this.mapTheme.getBaseMapStyle();
    this.map.setStyle(this.mapTheme.getFallbackBaseMapStyle());
  }

  protected handleSourceData(event: MapSourceDataEvent) {
    if (!event.tile || !this.previewer?.sourceIds.includes(event.sourceId)) return;
    this.previewer.tileLoaded(event.sourceId, tileZoom(event.tile));
    this.markPreviewDrawn();
  }

  protected handleSourceDataLoading(event: MapSourceDataEvent) {
    if (this.tilesLoading || !this.previewer?.sourceIds.includes(event.sourceId)) return;
    this.tilesLoading = true;
    this.mapLoading.emit();
  }

  private settleTileLoading() {
    if (!this.tilesLoading) return;
    this.tilesLoading = false;
    this.mapIdle.emit();
  }

  private setPreviewLoading(loading: boolean) {
    if (loading === this.previewLoading) return;
    this.previewLoading = loading;
    if (loading) this.mapLoading.emit();
    else this.mapIdle.emit();
  }

  private markPreviewDrawn() {
    this.previewDrawn = true;
    this.clearLoadDeadline();
  }

  protected startLoadDeadline() {
    this.clearLoadDeadline();
    if (!this.previewer) return;
    if (!this.previewer.sourceIds.length && !this.previewer.reportsDrawing) return;

    // A tile can arrive while preview() is still running, before the deadline is started.
    if (this.previewDrawn || this.errorReported) return;

    this.previewSettled = new Promise<void>(resolve => (this.settlePreview = resolve));

    const previewer = this.previewer;
    this.loadDeadline = setTimeout(() => {
      this.loadDeadline = undefined;
      if (!this.previewDrawn && this.previewer === previewer) {
        this.reportError(new TimeoutError(`a tile of ${previewer.url}`, previewer.loadTimeout));
      }
      this.clearLoadDeadline();
    }, previewer.loadTimeout);
  }

  private clearLoadDeadline() {
    if (this.loadDeadline !== undefined) {
      clearTimeout(this.loadDeadline);
      this.loadDeadline = undefined;
    }
    this.settlePreview();
  }

  private reportError(error: unknown) {
    if (this.errorReported || !this.previewer) return;
    this.errorReported = true;
    this.clearLoadDeadline();
    this.previewError.emit(referenceError(error, this.previewer.label(), this.previewer.url));
  }

  protected applyViewConstraints() {
    if (!this.map) return;
    const projection = this.previewer?.projection ?? 'globe';
    this.map.setProjection({ type: projection });
    this.globeControl.setHidden(projection !== 'globe');
    this.map.setMaxPitch(this.previewer?.maxPitch);
    this.map.setMinZoom(Math.max(MIN_ZOOM, this.previewer?.minZoom ?? MIN_ZOOM));
  }

  async fitMapBounds(bounds: LngLatBoundsLike) {
    return await fitBounds(this.map, this.mapTheme, bounds);
  }

  protected async fitToReportedBounds(previewer: MapPreviewer) {
    const declared = previewer.declaredBounds;
    if (!declared) return;

    const reported = await previewer.getReportedBounds().catch(error => {
      console.warn(`Could not read the extent of ${previewer.url}:`, error);
      return undefined;
    });
    if (!reported || boundsOverlap(declared, reported) || this.previewer !== previewer) return;

    console.warn(
      `The record's bounding box for ${previewer.url} (${describeBounds(declared)}) doesn't overlap the extent the data reports for itself (${describeBounds(reported)}); showing the data instead.`,
    );
    this.boundsNotice = MISPLACED_BOUNDS;
    await this.fitMapBounds(reported);
  }

  @Watch('padding')
  async onPaddingChange() {
    if (!this.map) return;
    return await this.easeMapTo({ padding: { left: this.padding } });
  }

  @Method()
  async easeMapTo(options: EaseToOptions) {
    return await this.map.easeTo(options);
  }

  @Listen('layerVisibilityChange')
  handleLayerVisibilityChange(event: CustomEvent<{ id: string; visible: boolean }>) {
    event.stopPropagation();
    this.setLayerState(event.detail.id, { visible: event.detail.visible });
  }

  @Listen('layerOpacityChange')
  handleLayerOpacityChange(event: CustomEvent<{ id: string; opacity: number }>) {
    event.stopPropagation();
    this.setLayerState(event.detail.id, { opacity: event.detail.opacity });
  }

  @Listen('layerColorRampChange')
  handleLayerColorRampChange(event: CustomEvent<{ id: string; colorRamp: LayerState['colorRamp'] }>) {
    event.stopPropagation();
    this.setLayerState(event.detail.id, { colorRamp: event.detail.colorRamp });
  }

  @Listen('layerBackgroundRemovalChange')
  handleLayerBackgroundRemovalChange(event: CustomEvent<{ id: string; removeBackground: boolean }>) {
    event.stopPropagation();
    this.setLayerState(event.detail.id, { removeBackground: event.detail.removeBackground });
  }

  @Listen('layerTimeChange')
  handleLayerTimeChange(event: CustomEvent<{ id: string; time: string }>) {
    event.stopPropagation();
    this.setLayerState(event.detail.id, { time: event.detail.time });
  }

  @Listen('layerTimeDomainRequest')
  handleLayerTimeDomainRequest(event: CustomEvent<{ id: string }>) {
    event.stopPropagation();
    this.previewer?.loadTimeDomain(event.detail.id);
  }

  @Listen('legendToggle')
  handleLegendToggle(event: CustomEvent<boolean>) {
    event.stopPropagation();
    this.legendOpen = event.detail;
  }

  @Listen('allLayersVisibilityChange')
  handleAllLayersVisibilityChange(event: CustomEvent<boolean>) {
    event.stopPropagation();
    const hidden = this.layerControls.map(item => this.recordLayerState(item.id, { visible: event.detail })).some(Boolean);
    this.commitLayerState(hidden);
  }

  protected toggleLayersPanel() {
    this.layersPanelOpen = !this.layersPanelOpen;
    this.layersControl.setPressed(this.layersPanelOpen);
  }

  private setLayerState(id: string, change: Partial<LayerState>) {
    const hidden = this.recordLayerState(id, change);
    this.commitLayerState(hidden);
  }

  // Merge against all resolved defaults so changing one control preserves the others.
  private recordLayerState(id: string, change: Partial<LayerState>): boolean {
    const layer = this.previewer?.previewLayers.find(previewLayer => previewLayer.id === id);
    if (!layer) return false;
    const current = this.layerState.get(id) ?? resolveLayerState(layer, this.layerState);
    const next = { ...current, ...change };
    this.layerState.set(id, next);
    return isLayerDrawn(current) && !isLayerDrawn(next);
  }

  private commitLayerState(hidden: boolean) {
    this.applyLayerState();
    this.setupLayerControls();
    if (!hidden) return;
    this.destroyPopup();
    this.clearHoveredFeature();
    if (this.map) this.map.getCanvas().style.cursor = '';
  }

  private applyLayerState() {
    if (!this.previewer || !this.mapStyleLoaded) return;
    this.previewer.applyLayerState(this.layerState);
  }

  private setupLayerControls() {
    this.layerControls = getLayerControls(this.previewer?.previewLayers ?? [], this.layerState);
  }

  protected handleHover(event: MapMouseEvent) {
    if (this.previewer && !this.previewer.inspectable) {
      this.map.getCanvas().style.cursor = '';
      return;
    }

    if (this.previewer instanceof InspectableRasterPreviewer) {
      this.map.getCanvas().style.cursor = this.previewer.canInspect && this.previewer.anyLayerVisible ? 'crosshair' : '';
      return;
    }

    const features = dedupeFeatures(this.map.queryRenderedFeatures(event.point, { layers: this.queryableLayerIds }));

    if (features.length > 0) {
      this.map.getCanvas().style.cursor = 'crosshair';
      this.hoverFeature(features[0]);
    } else {
      this.map.getCanvas().style.cursor = '';
      this.clearHoveredFeature();
    }
  }

  protected async handleClick(event: MapMouseEvent) {
    this.destroyPopup();

    const features = await this.handleInspection(event.point).catch(error => {
      console.error(`Error inspecting ${this.previewer?.url}:`, error);
      return [];
    });
    if (features.length === 0) return;

    this.attributesEl.kind = this.previewer?.kind;
    this.attributesEl.requestTransform = this.previewer?.requestTransform;
    this.attributesEl.references = this.references;
    this.attributesEl.features = features;
    this.createPopup(event.lngLat);
    this.selectFeature(features[0]);
  }

  protected async handleInspection(point: Point): Promise<MapGeoJSONFeature[]> {
    if (!this.previewer) return [];

    if (!this.previewer.inspectable) return [];

    if (this.previewer instanceof InspectableRasterPreviewer) {
      if (!this.previewer.canInspect || !this.previewer.anyLayerVisible) return [];
      return dedupeFeatures(await this.previewer.inspect(this.queryWindow(point)));
    }

    return await this.previewer.expandFeatures(dedupeFeatures(this.map.queryRenderedFeatures(point, { layers: this.queryableLayerIds })));
  }

  // Unproject a local pixel window so inspection works with rotation, pitch, and globe projection.
  protected queryWindow(point: Point): PixelWindow {
    const half = (QUERY_WINDOW - 1) / 2;
    const corners = [
      [point.x - half, point.y - half],
      [point.x + half, point.y - half],
      [point.x + half, point.y + half],
      [point.x - half, point.y + half],
    ].map(([x, y]) => this.map.unproject([x, y]));

    return {
      bbox: mercatorBbox(corners),
      width: QUERY_WINDOW,
      height: QUERY_WINDOW,
      x: half,
      y: half,
    };
  }

  @Listen('featureSelected')
  handleFeatureSelected(event: CustomEvent<MapGeoJSONFeature>) {
    if (!this.map) return;
    this.selectFeature(event.detail);
  }

  protected clearFeatureSelection() {
    if (this.previewer instanceof InspectableRasterPreviewer) {
      this.previewer.clearHighlight();
      return;
    }
    if (!this.selectedFeature) return;
    this.setFeatureState(this.selectedFeature, { selected: false });
    this.selectedFeature = undefined;
  }

  protected selectFeature(feature: MapGeoJSONFeature) {
    if (this.previewer instanceof InspectableRasterPreviewer) {
      this.previewer.highlightFeatures([feature]);
      return;
    }
    this.clearFeatureSelection();
    this.selectedFeature = feature;
    this.setFeatureState(feature, { selected: true });
  }

  protected hoverFeature(feature: MapGeoJSONFeature) {
    this.clearHoveredFeature();
    this.hoveredFeature = feature;
    this.setFeatureState(feature, { hover: true });
  }

  protected clearHoveredFeature() {
    if (!this.hoveredFeature) return;
    this.setFeatureState(this.hoveredFeature, { hover: false });
    this.hoveredFeature = undefined;
  }

  // Features without IDs need a property filter; MapLibre refuses feature-state updates for them.
  private setFeatureState(feature: MapGeoJSONFeature, state: { hover?: boolean; selected?: boolean }) {
    if (!this.map) return;
    if (identified(feature)) {
      this.map.setFeatureState({ source: feature.source, id: feature.id, sourceLayer: feature.sourceLayer }, state);
    } else if (state.selected !== undefined) {
      this.previewer?.matchSelection(state.selected ? feature : undefined);
    }
  }

  protected createPopup(location: LngLatLike) {
    this.popup = new Popup({ maxWidth: 'none' }).setDOMContent(this.attributesEl).setLngLat(location).addTo(this.map);

    // Recalculate the popup anchor when asynchronous content changes its size.
    this.popupResize = new ResizeObserver(() => this.popup?.setLngLat(this.popup.getLngLat()));
    this.popupResize.observe(this.attributesEl);

    this.popup.on('close', () => {
      this.popup = undefined;
      this.popupResize?.disconnect();
      this.popupResize = undefined;
      this.clearFeatureSelection();
      this.attributesEl.features = [];
    });
  }

  protected destroyPopup() {
    if (this.popup) this.popup.remove();
  }

  protected get queryableLayerIds() {
    return this.previewer?.visibleLayerIds || [];
  }

  // Keep Stencil panels outside #map so MapLibre can manage its children without detaching them.
  render() {
    const legendEntries = this.previewer?.legendEntries ?? [];
    const hasLegend = legendEntries.length > 0 || rampedLayers(this.layerControls).length > 0 || imageLegends(this.layerControls, this.zoom).length > 0;

    return (
      <Host class={waScope(this.theme)}>
        <div class={`container ${waScope(this.theme)}`}>
          <div id="map"></div>
          {(this.notice || this.boundsNotice || this.basemapNotice) && (
            <div class="notices">
              {this.notice && (
                <wa-callout class="notice" variant="brand" size="s">
                  <wa-icon slot="icon" name="info-circle-fill"></wa-icon>
                  {this.notice}
                </wa-callout>
              )}
              {this.boundsNotice && (
                <wa-callout class="notice bounds-notice" variant="warning" size="s">
                  <wa-icon slot="icon" name="exclamation-triangle-fill"></wa-icon>
                  {this.boundsNotice}
                </wa-callout>
              )}
              {this.basemapNotice && (
                <wa-callout class="notice basemap-notice" variant="warning" size="s">
                  <wa-icon slot="icon" name="exclamation-triangle-fill"></wa-icon>
                  <div class="basemap-message">{this.basemapNotice}</div>
                  {this.failedBasemap && (
                    <div class="basemap-url" title={this.failedBasemap}>
                      {this.failedBasemap}
                    </div>
                  )}
                </wa-callout>
              )}
            </div>
          )}
          {timedLayers(this.layerControls).length > 0 && <ogm-time theme={this.theme} layers={this.layerControls}></ogm-time>}
          {this.layersPanelOpen && <ogm-layers theme={this.theme} layers={this.layerControls}></ogm-layers>}
          {hasLegend && <ogm-legend theme={this.theme} layers={this.layerControls} entries={legendEntries} zoom={this.zoom} open={this.legendOpen}></ogm-legend>}
        </div>
      </Host>
    );
  }
}
