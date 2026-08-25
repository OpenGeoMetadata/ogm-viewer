import { Component, Element, Event, EventEmitter, h, Host, Listen, Method, Prop, State, Watch } from '@stencil/core';
import maplibregl from 'maplibre-gl';

import { closestAcrossShadows, findElement, getElement } from '../../lib/elements';
import { referenceError, TimeoutError, type PreviewError } from '../../lib/errors';
import GlobeControl from '../../lib/globe-control';
import { adoptWebAwesomeTheme, initialTheme, waScope } from '../../lib/init';
import { dedupeFeatures } from '../../lib/features';
import { mercatorBbox, type PixelWindow } from '../../lib/geometry';
import { createMap, fitBounds, openingCamera, setBasemap, whenSized } from '../../lib/maps';
import { isLayerDrawn, rampedLayers, resolveLayerState, toLayerControlItems as getLayerControls, type LayerControl, type LayerState } from '../../lib/layers';
import LayersControl from '../../lib/layers-control';
import InspectableRasterPreviewer from '../../lib/previewers/inspectable-raster';
import type MapPreviewer from '../../lib/previewers/map';
import { ourResourceType, toMapLibreRequest } from '../../lib/request';
import MapLibreTheme from '../../lib/themes/maplibre';

// Size in CSS pixels of the window we ask a server about when inspecting. WMS and ArcGIS both
// locate a click by mapping a pixel grid onto a bbox, which assumes the view is a flat, north-up
// rectangle - but ours can be rotated, pitched, or drawn as a globe. So we describe a small window
// around the click rather than the whole viewport, which keeps that assumption true to within a
// fraction of a pixel. Odd-numbered so the clicked pixel is the exact center of the window.
const QUERY_WINDOW = 51;

// A component for rendering an interactive data preview on a map
@Component({
  tag: 'ogm-map',
  styleUrl: 'ogm-map.css',
  shadow: true,
})
export class OgmMap {
  @Element() el!: HTMLElement;
  @Prop() previewer: MapPreviewer;
  @Prop() theme: 'light' | 'dark' = initialTheme(this.el);
  // A caller's own basemap for each mode, as a CARTO name (e.g. 'positron') or a URL to a MapLibre
  // style document; see MapLibreTheme.getBaseMapStyle. Undefined keeps this library's own default.
  @Prop() darkBasemap?: string;
  @Prop() lightBasemap?: string;
  @Prop() padding: number = 0;

  /**
   * Whether a wheel needs the command key, and a touch drag needs a second finger, before either
   * reaches the map - see MapLibre's CooperativeGesturesHandler. On by default, since a small map
   * embedded in a page must not eat the scroll a reader meant for the page around it. A page that
   * gives the map the whole screen, or has its own way of keeping the two apart, can turn it off.
   */
  @Prop() cooperativeGestures: boolean = true;

  @Event() mapIdle: EventEmitter<void>;
  @Event() mapLoading: EventEmitter<void>;
  @Event() previewError: EventEmitter<PreviewError>;

  // Layer control panel state tracking
  @State() layerControls: LayerControl[] = [];
  @State() layersPanelOpen: boolean = false;
  protected layersControl: LayersControl;
  private layerState = new Map<string, LayerState>();

  // Needs nothing to build, unlike the layers control, so it exists from the start and
  // applyViewConstraints can reach for it without minding whether the map has its controls yet
  protected globeControl = new GlobeControl();

  // Used to prevent trying to style layers before the map is ready
  private mapStyleLoaded: boolean = false;

  // Guards against reporting more than one error per load attempt
  private errorReported: boolean = false;

  // The deadline the current load attempt is being held to, and whether it has been met. See
  // startLoadDeadline.
  private loadDeadline: ReturnType<typeof setTimeout> | undefined = undefined;
  private previewDrawn: boolean = false;

  // Resolves once the current attempt has an answer - the preview's first tile arrived, or the
  // deadline gave up on it - which is what the spinner is held up by. Starts resolved, since there
  // is nothing to wait for until a load is under way, and every path that ends an attempt resolves
  // it: nothing here may leave the spinner turning forever. See startLoadDeadline.
  private previewSettled: Promise<void> = Promise.resolve();
  private settlePreview: () => void = () => {};

  // MapLibre map instance and popup instance for feature info display
  protected map: maplibregl.Map;
  protected mapTheme: MapLibreTheme;
  protected popup: maplibregl.Popup | undefined = undefined;
  // Watches the popup's contents for a change of size; see createPopup
  protected popupResize: ResizeObserver | undefined = undefined;
  protected attributesEl: HTMLOgmAttributesElement;
  protected hoveredFeature: maplibregl.MapGeoJSONFeature | undefined = undefined;
  protected selectedFeature: maplibregl.MapGeoJSONFeature | undefined = undefined;

  // Before the first frame, so nothing paints unstyled
  componentWillLoad() {
    adoptWebAwesomeTheme(this.el);
  }

  // Set up the mapLibre map and event bindings on load
  async componentDidLoad() {
    // The theme reads from the element carrying the Web Awesome scope, not from the host: see render
    // for why the host has no colors on it to read. Everything MapLibre draws is inside this element,
    // so an --ogm-* override set on the host or on the embedding page still reaches it by inheritance.
    const scope = getElement(this.el, '.container');
    this.mapTheme = new MapLibreTheme(scope, this.theme, { darkBasemap: this.darkBasemap, lightBasemap: this.lightBasemap });

    // Keep attributes outside Stencil render pipeline so that MapLibre can
    // use the HTML directly for the popup content
    this.attributesEl = document.createElement('ogm-attributes') as HTMLOgmAttributesElement;
    this.attributesEl.features = [];

    // Wait until we're inside an element that actually has a box to draw the map
    // into, otherwise MapLibre will throw errors
    const container = getElement(this.el, '#map');
    await whenSized(container);

    // Taken back off the page while we waited
    if (!this.el.isConnected) return;

    this.map = createMap(container, this.mapTheme, {
      minZoom: 1,
      cooperativeGestures: this.cooperativeGestures,
      // Read fresh on every request rather than captured once, so it always reflects whichever
      // previewer is currently attached - including across onPreviewerChange, with no watcher of
      // our own needed. Applies to the basemap's own style/glyphs/sprites too, not just this
      // preview's data; see RequestTransform for why a transform has to account for that itself.
      transformRequest: (url, resourceType) => toMapLibreRequest(this.previewer?.requestTransform?.(url, ourResourceType(resourceType)), url),
      // Already looking at the record, rather than at the world for as long as it takes the preview to
      // draw and loadPreview to fit the camera to it - which is a round trip or two, and every one of
      // them is spent watching a basemap of somewhere else. Only what the record declared, since that
      // is the part that can be answered without asking anyone; see MapPreviewer.declaredBounds. A
      // resource that reads a truer extent for itself is still fitted to that one below.
      ...openingCamera(container, this.mapTheme, this.previewer?.declaredBounds),
    });

    // Bound before the controls go on, so the preview still works if that fails
    this.map.on('load', () => this.loadPreview());
    this.map.on('mousemove', this.handleHover.bind(this));
    this.map.on('click', this.handleClick.bind(this));
    this.map.on('error', this.handleMapError.bind(this));
    this.map.on('sourcedata', this.handleSourceData.bind(this));
    this.addControls();

    // Style as a globe with atmosphere once style is loaded and set the flag
    this.map.on('style.load', () => {
      this.mapStyleLoaded = true;
      this.applyViewConstraints();
      this.map.setSky(this.mapTheme.getSkyStyle());
    });
  }

  // Clean up the map to prevent warnings/errors when removed from the DOM. The popup comes down
  // first: MapLibre closes it for us on the way out, and closing it ends an inspection, which reaches
  // back into the map to clear the highlight and hands the features back to whoever is listening. All
  // of that wants a map that is still there, so it happens before the map goes rather than during it.
  disconnectedCallback() {
    this.clearLoadDeadline();
    this.destroyPopup();
    if (this.map) this.map.remove();
  }

  // What the fullscreen button expands. Under an <ogm-viewer> that's the whole viewer, so the
  // menubar and sidebar come along with the map; on our own it is just us. Found by walking out
  // through the shadow roots we sit in rather than by asking the document, which would pick the
  // first viewer on the page whether or not it is the one we're inside.
  protected getContainer(): HTMLElement {
    const viewerEl = closestAcrossShadows(this.el, 'ogm-viewer');
    return (viewerEl && findElement(viewerEl, '.container')) ?? this.el;
  }

  // Add controls to the map, ordered from top down
  protected addControls() {
    this.map.addControl(
      new maplibregl.NavigationControl({
        visualizePitch: true,
      }),
    );
    this.layersControl = new LayersControl(this.toggleLayersPanel.bind(this));
    this.map.addControl(this.layersControl);
    this.map.addControl(
      new maplibregl.FullscreenControl({
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

  // Draw the current preview onto the map.
  async loadPreview() {
    if (!this.previewer || !this.map) return;

    // Nothing can be written into a style document that hasn't loaded: setProjection below and the
    // addSource every preview draws itself with both throw before it has. Nothing is lost by holding
    // off, because whichever style is on its way draws the preview as it lands - the map's own load
    // event for the first one, and the handler onThemeChange registers for every one after it.
    //
    // Reached only by a previewer handed to a live standalone <ogm-map>, which is the one way a preview
    // can arrive mid-load: under <ogm-preview> it is an initial prop, so the watcher never fires in that
    // window. And it has to be caught here rather than thrown and reported, because Stencil doesn't
    // await a watcher - what that throws escapes as an unhandled rejection instead of reaching
    // reportError, leaving nothing drawn and nothing said about it.
    if (!this.mapStyleLoaded) return;

    // Fresh load attempt: allow one error to be reported again for this preview, and put the
    // deadline the last one was held to back on the clock
    this.errorReported = false;
    this.clearLoadDeadline();
    this.previewDrawn = false;

    // Indicate loading state so we can show the spinner
    this.mapLoading.emit();

    // Clear layer controls list and state
    this.layerControls = [];
    this.layerState.clear();
    this.layersPanelOpen = false;
    this.layersControl.setPressed(false);

    // Close popup if one is open
    this.destroyPopup();

    // Applied here as well as on style.load, since which preview is attached is what decides these and
    // that can change without the style document being rebuilt
    this.applyViewConstraints();

    // A preview that paints with its own WebGL - deck.gl's COG overlay, an Allmaps warped scan - has
    // no MapLibre source to report on, and only finds out how it went once its tiles start arriving,
    // after preview() below has resolved. So it reports both outcomes itself: a failure gets the same
    // alert a failed load gets, and a tile drawn is what satisfies the deadline started further down,
    // in place of the map's own tile events. Both bound to the previewer they came from rather than to
    // whichever is current, so a tile of the record we just left can't answer for the one that
    // replaced it.
    const previewer = this.previewer;
    previewer.onError = error => {
      if (this.previewer === previewer) this.reportError(error);
    };
    previewer.onDrawn = () => {
      if (this.previewer === previewer) this.markPreviewDrawn();
    };

    try {
      // The style is only known now: it comes out of the theme, and the theme can change under a
      // preview that is already on screen
      this.previewer.attach(this.map, this.mapTheme.getStyle());
      await this.previewer.preview();

      // The map has been told what to draw, so this is where the wait for it to actually appear
      // begins. Started before the bounds are fitted rather than after, because the tiles the
      // default view asks for are already on their way by now. Held onto rather than read again
      // below, so that a load starting under this one - a theme change mid-flight - can't leave this
      // attempt waiting on that one's answer instead of its own.
      this.startLoadDeadline();
      const settled = this.previewSettled;

      // Set up the layer controls
      this.applyLayerState();
      this.setupLayerControls();

      // Fit to the preview's bounds; the spinner stays up until the map finishes moving
      const bounds = await this.previewer.getBounds();
      if (bounds) await this.fitMapBounds(bounds);

      // The camera has arrived, but the data it was pointed at may not have. Keep the spinner up
      // until the preview's first tile lands or its deadline expires, so that a preview which never
      // draws spins and then says so, rather than presenting itself as loaded and staying blank.
      await settled;
    } catch (error) {
      console.error(`Error previewing ${this.previewer.url}:`, error);
      this.reportError(error);
    } finally {
      this.mapIdle.emit();
    }
  }

  // When the theme or a basemap prop changes, swap the basemap to match.
  @Watch('theme')
  @Watch('darkBasemap')
  @Watch('lightBasemap')
  async onThemeChange() {
    if (!this.map) return;
    this.mapTheme.theme = this.theme;
    this.mapTheme.darkBasemap = this.darkBasemap;
    this.mapTheme.lightBasemap = this.lightBasemap;
    // The popup reads from sources setStyle is about to drop, so it goes first
    this.destroyPopup();
    // The panel is still on screen over the window this opens, and a layer can't be styled inside it
    this.mapStyleLoaded = false;
    await setBasemap(this.map, this.mapTheme);
    // The same preview, drawn again into the style document the swap just emptied
    await this.loadPreview();
  }

  // A reader gets the changed answer from here on; the handler needs nothing rebuilt to give it, so
  // there's no draw or frame to redo the way a theme swap needs.
  @Watch('cooperativeGestures')
  onCooperativeGesturesChange() {
    if (!this.map) return;
    if (this.cooperativeGestures) this.map.cooperativeGestures.enable();
    else this.map.cooperativeGestures.disable();
  }

  // Surface MapLibre errors tied to the current preview, skipping the noise from basemap/glyph/
  // sprite loads, and deduped to a single alert per load attempt.
  protected handleMapError(event: maplibregl.ErrorEvent & { sourceId?: string }) {
    if (this.errorReported || !this.previewer) return;
    if (!this.previewer.sourceIds.includes(event.sourceId ?? '')) return;
    this.reportError(event.error);
  }

  // One tile of the current preview arriving is the only proof that the preview is really there, so
  // it's what the deadline below waits for. MapLibre fires this with a tile on it from one place
  // only - a tile that finished loading and wasn't aborted - so its presence is the whole test; the
  // same event without one is describing the source rather than any of its contents.
  protected handleSourceData(event: maplibregl.MapSourceDataEvent) {
    if (!event.tile || !this.previewer?.sourceIds.includes(event.sourceId)) return;
    this.markPreviewDrawn();
  }

  // Something of the current preview is on the map. Reached from the map's own tile events above for
  // everything MapLibre draws, and from the onDrawn hook for the two previews that draw themselves.
  private markPreviewDrawn() {
    this.previewDrawn = true;
    this.clearLoadDeadline();
  }

  // Hold this load attempt to a deadline, and call it a failure if nothing is drawn by then.
  protected startLoadDeadline() {
    this.clearLoadDeadline();
    if (!this.previewer) return;
    if (!this.previewer.sourceIds.length && !this.previewer.reportsDrawing) return;

    // Already answered, before we even got here: MapLibre starts fetching the moment a source goes
    // on, so a tile can land - or fail loudly enough to be reported - while preview() is still
    // adding the rest of them. Arming anyway would hold the spinner for the full deadline over a
    // preview that has either already drawn or already said what went wrong.
    if (this.previewDrawn || this.errorReported) return;

    this.previewSettled = new Promise<void>(resolve => (this.settlePreview = resolve));

    // Held against the previewer this attempt was for, not whichever is current when it expires, so
    // a preview the user has already moved on from can't accuse the one that replaced it
    const previewer = this.previewer;
    this.loadDeadline = setTimeout(() => {
      this.loadDeadline = undefined;
      if (!this.previewDrawn && this.previewer === previewer) {
        this.reportError(new TimeoutError(`a tile of ${previewer.url}`, previewer.loadTimeout));
      }
      // Reached whether or not an alert went up: reportError only speaks once per attempt, and a
      // preview that has since been replaced gets no alert at all, but this attempt is over either
      // way and whatever is waiting on it has to be let go.
      this.clearLoadDeadline();
    }, previewer.loadTimeout);
  }

  // Ends the current attempt's wait, from any of the four things that can end it: its first tile
  // arriving, its deadline expiring, an error being reported, or the attempt being abandoned for a
  // new load or a teardown.
  private clearLoadDeadline() {
    if (this.loadDeadline !== undefined) {
      clearTimeout(this.loadDeadline);
      this.loadDeadline = undefined;
    }
    this.settlePreview();
  }

  // Emit a single preview error per load attempt
  private reportError(error: unknown) {
    if (this.errorReported || !this.previewer) return;
    this.errorReported = true;
    // Whatever the deadline was still waiting for, it has nothing left to add: the alert it would
    // have raised is the one already going up
    this.clearLoadDeadline();
    this.previewError.emit(referenceError(error, this.previewer.label(), this.previewer.url));
  }

  // Draw the map the way the current preview needs it drawn: on a globe unless the preview can't be
  // shown on one, and tilted no further than it can be drawn tilted. See MapPreviewer.projection and
  // maxPitch. The globe control goes with the projection, since a preview that needs a flat map would
  // only be drawn wrong in whatever else that button could offer; the pitch needs no such handling,
  // because setMaxPitch is what the drag gestures and the compass are already bounded by. Undefined is
  // MapLibre's own default, so there's no limit of ours to keep in step with theirs.
  protected applyViewConstraints() {
    if (!this.map) return;
    const projection = this.previewer?.projection ?? 'globe';
    this.map.setProjection({ type: projection });
    this.globeControl.setHidden(projection !== 'globe');
    this.map.setMaxPitch(this.previewer?.maxPitch);
  }

  // Fit the map to the given bounds; resolve once the move finishes. What the sidebar covers is the
  // map's own padding (see onPaddingChange), which MapLibre already takes off the space it fits
  // bounds into, so only the theme's gap is left for fitMapBounds to add.
  async fitMapBounds(bounds: maplibregl.LngLatBoundsLike) {
    return await fitBounds(this.map, this.mapTheme, bounds);
  }

  // When padding is changed, move the map over to make room for the sidebar
  @Watch('padding')
  async onPaddingChange() {
    if (!this.map) return;
    return await this.easeMapTo({ padding: { left: this.padding } });
  }

  // Move the map (e.g. when the sidebar moves)
  @Method()
  async easeMapTo(options: maplibregl.EaseToOptions) {
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

  // Used when the user toggles the summary checkbox to show/hide all layers at once
  @Listen('allLayersVisibilityChange')
  handleAllLayersVisibilityChange(event: CustomEvent<boolean>) {
    event.stopPropagation();
    const hidden = this.layerControls.map(item => this.recordLayerState(item.id, { visible: event.detail })).some(Boolean);
    this.commitLayerState(hidden);
  }

  // Show/hide the layers panel
  protected toggleLayersPanel() {
    this.layersPanelOpen = !this.layersPanelOpen;
    this.layersControl.setPressed(this.layersPanelOpen);
  }

  // Remember one row's change, then push everything to the map at once
  private setLayerState(id: string, change: Partial<LayerState>) {
    const hidden = this.recordLayerState(id, change);
    this.commitLayerState(hidden);
  }

  // Update the layer state for a layer; return true if it just changed
  // to hidden so we can clear popups/highlights
  //
  // The starting point for `current` has to be resolveLayerState's own, not a copy of the same two
  // fields written out here by hand: that copy is how a ramp choice, once LayerState grew one,
  // would have gone missing on the very next opacity change - `{...current, ...change}` merges the
  // rest of `current` forward untouched, but only if `current` already had every field a layer
  // might carry, which a hand-written `{ visible, opacity }` never will once a third one exists.
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

  // Send changes to the layer state to the previewer
  private applyLayerState() {
    if (!this.previewer || !this.mapStyleLoaded) return;
    this.previewer.applyLayerState(this.layerState);
  }

  // Populate the layer controls in the panel
  private setupLayerControls() {
    this.layerControls = getLayerControls(this.previewer?.previewLayers ?? [], this.layerState);
  }

  // Use the crosshair cursor if there's something to inspect
  protected handleHover(event: maplibregl.MapMouseEvent) {
    // A preview with nothing to answer with never offers. Checked before the raster case below, which
    // is a question about how to ask rather than whether to.
    if (this.previewer && !this.previewer.inspectable) {
      this.map.getCanvas().style.cursor = '';
      return;
    }

    // A server-drawn preview has no client-side features to test the cursor against, so offer to
    // inspect anywhere as long as the server will answer at all - and as long as any of it is still
    // drawn, since a hidden layer has nothing to be asked about
    if (this.previewer instanceof InspectableRasterPreviewer) {
      this.map.getCanvas().style.cursor = this.previewer.canInspect && this.previewer.anyLayerVisible ? 'crosshair' : '';
      return;
    }

    const features = this.map.queryRenderedFeatures(event.point, { layers: this.queryableLayerIds });

    if (features.length > 0) {
      this.map.getCanvas().style.cursor = 'crosshair';
      this.hoverFeature(features[0]);
    } else {
      this.map.getCanvas().style.cursor = '';
      this.clearHoveredFeature();
    }
  }

  // Show the attributes popup on click
  protected async handleClick(event: maplibregl.MapMouseEvent) {
    // Clear any existing popup and feature selection
    this.destroyPopup();

    // Get the features, if any, at the clicked point. If none, do nothing. A failed request means
    // this one click went unanswered, not that the preview is broken, so it stays out of the alerts.
    const features = await this.handleInspection(event.point).catch(error => {
      console.error(`Error inspecting ${this.previewer?.url}:`, error);
      return [];
    });
    if (features.length === 0) return;

    // Create and populate the attributes popup and select the first feature if multiple. What kind of
    // preview these came from decides how they're described, and goes over first so the popup never
    // paints a table of raw keys for something it could have named properly.
    this.attributesEl.kind = this.previewer?.kind;
    this.attributesEl.requestTransform = this.previewer?.requestTransform;
    this.attributesEl.features = features;
    this.createPopup(event.lngLat);
    this.selectFeature(features[0]);
  }

  // Delegate to server for raster inspection, or query directly for vector
  protected async handleInspection(point: maplibregl.Point): Promise<maplibregl.MapGeoJSONFeature[]> {
    if (!this.previewer) return [];

    // Drawn, but not about anything: a location has one shape and no properties behind it, so a
    // query would return a feature and the popup would open on an empty table.
    if (!this.previewer.inspectable) return [];

    if (this.previewer instanceof InspectableRasterPreviewer) {
      if (!this.previewer.canInspect || !this.previewer.anyLayerVisible) return [];
      return dedupeFeatures(await this.previewer.inspect(this.queryWindow(point)));
    }

    return dedupeFeatures(this.map.queryRenderedFeatures(point, { layers: this.queryableLayerIds }));
  }

  // The window around a click to ask a server about. Its corners are in the same CSS pixel space
  // as the click; let MapLibre unproject them so the geography stays right under any projection,
  // then take their EPSG:3857 envelope, since that is the CRS we request.
  protected queryWindow(point: maplibregl.Point): PixelWindow {
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

  // Listen to selection events from the popup and highlight the selected feature. Ours to hear
  // because MapLibre builds the popup inside the map's own container, which is in our shadow root,
  // so the event passes through us on its way out - and through no other map. Listened for on the
  // document instead, as it once was, every <ogm-map> on the page would answer for every popup: a
  // record change replaces them all at once, and the ones that had not built their maps yet threw.
  @Listen('featureSelected')
  handleFeatureSelected(event: CustomEvent<maplibregl.MapGeoJSONFeature>) {
    if (!this.map) return;
    this.selectFeature(event.detail);
  }

  // Reset styling of the selected feature to unselected state
  protected clearFeatureSelection() {
    if (this.previewer instanceof InspectableRasterPreviewer) {
      this.previewer.clearHighlight();
      return;
    }
    if (!this.selectedFeature) return;
    this.setFeatureState(this.selectedFeature, { selected: false });
    this.selectedFeature = undefined;
  }

  // Set styling of a single feature to selected state, releasing whatever was selected before it
  protected selectFeature(feature: maplibregl.MapGeoJSONFeature) {
    // A server-drawn raster has no client-side features to restyle, so the previewer outlines the
    // geometry the server sent back instead - and one highlight replaces the last
    if (this.previewer instanceof InspectableRasterPreviewer) {
      this.previewer.highlightFeatures([feature]);
      return;
    }
    this.clearFeatureSelection();
    this.selectedFeature = feature;
    this.setFeatureState(feature, { selected: true });
  }

  // Set styling of a single feature to hovered state
  protected hoverFeature(feature: maplibregl.MapGeoJSONFeature) {
    this.clearHoveredFeature();
    this.hoveredFeature = feature;
    this.setFeatureState(feature, { hover: true });
  }

  // Clear the hovered feature state
  protected clearHoveredFeature() {
    if (!this.hoveredFeature) return;
    this.setFeatureState(this.hoveredFeature, { hover: false });
    this.hoveredFeature = undefined;
  }

  // Restyle one of the preview's own features. Every path into here starts outside the map - a
  // pointer event, a layer control, the popup - and the map is not there for all of that time: it
  // is built in componentDidLoad and taken down in disconnectedCallback. Nothing to restyle then.
  private setFeatureState(feature: maplibregl.MapGeoJSONFeature, state: { hover?: boolean; selected?: boolean }) {
    if (!this.map) return;
    this.map.setFeatureState({ source: feature.source, id: feature.id, sourceLayer: feature.sourceLayer }, state);
  }

  // Create a new popup and set its content and location
  protected createPopup(location: maplibregl.LngLatLike) {
    this.popup = new maplibregl.Popup({ maxWidth: 'none' }).setDOMContent(this.attributesEl).setLngLat(location).addTo(this.map);

    // MapLibre works out which side of the click to put the popup on from how big it is at the time,
    // and the contents don't stay that size: paging moves to a feature with more properties, and an
    // index map sheet's thumbnail arrives a fetch after the table it sits above. Left alone the popup
    // grows off the top of the map. Setting the same position again is what makes MapLibre measure and
    // place it a second time.
    this.popupResize = new ResizeObserver(() => this.popup?.setLngLat(this.popup.getLngLat()));
    this.popupResize.observe(this.attributesEl);

    // Closing the popup - by the user's click on its X, or by our own remove() - is what ends an
    // inspection, and the only thing that hands the features back. Emptying the list is what blanks
    // the table, so paging must not do it: it only moves the highlight from one feature to the next.
    this.popup.on('close', () => {
      this.popup = undefined;
      this.popupResize?.disconnect();
      this.popupResize = undefined;
      this.clearFeatureSelection();
      this.attributesEl.features = [];
    });
  }

  // Remove popup from the map. MapLibre fires 'close' from remove(), and only for a popup still on
  // the map, so the handler above does the rest of the teardown exactly once.
  protected destroyPopup() {
    if (this.popup) this.popup.remove();
  }

  // The layers a click may inspect: only what's actually drawn, and never the previewer's own
  // machinery. MapLibre answers the whole query with nothing if it names a layer the style lost.
  protected get queryableLayerIds() {
    return this.previewer?.visibleLayerIds || [];
  }

  // The layer panel and the legend are siblings of #map rather than MapLibre controls, even though
  // the button that opens the panel is one. MapLibre owns the children of #map, so anything Stencil
  // renders in there is fighting it for the same DOM - the reason ogm-attributes has to be built by
  // hand.
  //
  // Everything is wrapped in .container because that is where the Web Awesome scope has to go: the
  // classes waScope() applies are matched by the theme adopted into this root, and a plain class
  // selector in a shadow root's stylesheet never matches the host of that root. On the Host alone
  // they would establish nothing, which is what a bare <ogm-map> used to draw with - every color
  // empty. The panel and the legend need them as much as the map does, and neither is inside #map,
  // so the scope goes above all three.
  //
  // The legend is shown independently of the panel, unlike layersPanelOpen below: it exists to be
  // read while looking at the map, which is exactly when the panel that would have opened it is
  // closed. But it is gated the same way the panel is - mounted only when there's something for it
  // to show, via rampedLayers(this.layerControls) and the previewer's own named entries rather than
  // unconditionally with the component left to render null on its own. Both would look right to a
  // reader; only one of them is - see the note on this at the top of ogm-legend.tsx.
  render() {
    const legendEntries = this.previewer?.legendEntries ?? [];
    const hasLegend = legendEntries.length > 0 || rampedLayers(this.layerControls).length > 0;

    return (
      <Host class={waScope(this.theme)}>
        <div class={`container ${waScope(this.theme)}`}>
          <div id="map"></div>
          {this.layersPanelOpen && <ogm-layers theme={this.theme} layers={this.layerControls}></ogm-layers>}
          {hasLegend && <ogm-legend theme={this.theme} layers={this.layerControls} entries={legendEntries}></ogm-legend>}
        </div>
      </Host>
    );
  }
}
