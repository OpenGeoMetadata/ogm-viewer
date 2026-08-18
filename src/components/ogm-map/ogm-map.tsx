import { Component, Element, Event, EventEmitter, h, Host, Listen, Method, Prop, State, Watch } from '@stencil/core';
import maplibregl from 'maplibre-gl';

import { closestAcrossShadows, findElement, getElement } from '../../lib/elements';
import { referenceError, type PreviewError } from '../../lib/errors';
import GlobeControl from '../../lib/globe-control';
import { themePreference, waScope, webAwesomeReady, webAwesomeStylesheet } from '../../lib/init';
import { dedupeFeatures } from '../../lib/features';
import { mercatorBbox, type PixelWindow } from '../../lib/geometry';
import { isLayerDrawn, toLayerControlItems as getLayerControls, type LayerControl, type LayerState } from '../../lib/layers';
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

@Component({
  tag: 'ogm-map',
  styleUrl: 'ogm-map.css',
  shadow: true,
})
export class OgmMap {
  @Element() el: HTMLElement;
  @Prop() previewer: MapPreviewer;
  @Prop() theme: 'light' | 'dark' = themePreference();
  @Prop() padding: number = 0;
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

  // The last thing MapLibre complained about on the map itself rather than about one of our sources,
  // kept for the length of a load attempt; see reportDroppedLayers for what reads it and why.
  private lastStyleError: maplibregl.ErrorEvent['error'] | undefined = undefined;

  // MapLibre map instance and popup instance for feature info display
  protected map: maplibregl.Map;
  protected mapTheme: MapLibreTheme;
  // Resolves once the theme's colors can be read; see webAwesomeReady and loadPreview
  protected themeReady: Promise<void>;
  protected popup: maplibregl.Popup | undefined = undefined;
  // Watches the popup's contents for a change of size; see createPopup
  protected popupResize: ResizeObserver | undefined = undefined;
  protected attributesEl: HTMLOgmAttributesElement;
  protected hoveredFeature: maplibregl.MapGeoJSONFeature | undefined = undefined;
  protected selectedFeature: maplibregl.MapGeoJSONFeature | undefined = undefined;

  // Set up the mapLibre map and event bindings on load
  componentDidLoad() {
    // The theme reads from the element carrying the Web Awesome scope, not from the host: see render
    // for why the host has no colors on it to read. Everything MapLibre draws is inside this element,
    // so an --ogm-* override set on the host or on the embedding page still reaches it by inheritance.
    const scope = getElement(this.el, '.container');
    this.mapTheme = new MapLibreTheme(scope, this.theme);
    // Asked for here, in the same task that rendered the link, and awaited in loadPreview
    this.themeReady = webAwesomeReady(getElement(this.el, 'link'), scope);

    this.map = new maplibregl.Map({
      container: getElement(this.el, '#map'),
      // The basemaps are CARTO's, over OpenStreetMap data; both require attribution. Compact so it
      // is a single "i" in the corner until clicked, which is all an embedded map has room for.
      attributionControl: { compact: true },
      cooperativeGestures: true,
      style: this.mapTheme.getBaseMapStyle(),
      center: [0, 0],
      zoom: 2,
      minZoom: 2,
      // Read fresh on every request rather than captured once, so it always reflects whichever
      // previewer is currently attached - including across onPreviewerChange, with no watcher of
      // our own needed. Applies to the basemap's own style/glyphs/sprites too, not just this
      // preview's data; see RequestTransform for why a transform has to account for that itself.
      transformRequest: (url, resourceType) => toMapLibreRequest(this.previewer?.requestTransform?.(url, ourResourceType(resourceType)), url),
    });

    // Bound before the controls go on: a control that can't be built shouldn't cost us the preview
    this.map.on('load', () => this.loadPreview());
    this.map.on('mousemove', this.handleHover.bind(this));
    this.map.on('click', this.handleClick.bind(this));
    this.map.on('error', this.handleMapError.bind(this));
    this.addControls();

    // Style as a globe with atmosphere once style is loaded and set the flag
    this.map.on('style.load', () => {
      this.mapStyleLoaded = true;
      this.applyViewConstraints();
      this.map.setSky(this.mapTheme.getSkyStyle());
    });

    // Keep attributes outside Stencil render pipeline so that MapLibre can
    // use the HTML directly for the popup content
    this.attributesEl = document.createElement('ogm-attributes') as HTMLOgmAttributesElement;
    this.attributesEl.features = [];
  }

  // Clean up the map to prevent warnings/errors when removed from the DOM. The popup comes down
  // first: MapLibre closes it for us on the way out, and closing it ends an inspection, which reaches
  // back into the map to clear the highlight and hands the features back to whoever is listening. All
  // of that wants a map that is still there, so it happens before the map goes rather than during it.
  disconnectedCallback() {
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

    // Fresh load attempt: allow one error to be reported again for this preview, and forget what the
    // last one complained about
    this.errorReported = false;
    this.lastStyleError = undefined;

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

    // A preview that paints with its own WebGL - deck.gl's COG overlay - has no MapLibre source to
    // report on, and only finds out it can't be drawn once its tiles start arriving, after preview()
    // below has resolved. Give it the same alert a failed load gets. Bound to the previewer it came
    // from rather than to whichever is current, so a tile of the record we just left can't report
    // against the one that replaced it.
    const previewer = this.previewer;
    previewer.onError = error => {
      if (this.previewer === previewer) this.reportError(error);
    };

    try {
      // Nothing below can be drawn until the colors it would be drawn in can be read, and the
      // stylesheet they come from is linked into our own shadow root - on a first load it may still
      // be arriving. Waiting on the MapLibre 'load' event that brought us here is not the same thing:
      // that waits for a round trip to a tile server, which usually but not always takes longer, and
      // the redraw after a theme change starts from 'style.load', which is earlier still.
      await this.themeReady;

      // The style is only known now: it comes out of the theme, and the theme can change under a
      // preview that is already on screen
      this.previewer.attach(this.map, this.mapTheme.getStyle());
      await this.previewer.preview();

      // Drawing is not the same as drawn: MapLibre drops a layer it rejects without a word, and
      // preview() resolves as though it landed. Reported here and then carried on from, because
      // whatever did land is still worth showing the user and still worth pointing the map at.
      this.reportDroppedLayers();

      // Set up the layer controls
      this.applyLayerState();
      this.setupLayerControls();

      // Fit to the preview's bounds; the spinner stays up until the map finishes moving
      const bounds = await this.previewer.getBounds();
      if (bounds) await this.fitMapBounds(bounds);
    } catch (error) {
      console.error(`Error previewing ${this.previewer.url}:`, error);
      this.reportError(error);
    } finally {
      this.mapIdle.emit();
    }
  }

  // When the theme changes, swap the basemap to match.
  @Watch('theme')
  onThemeChange() {
    if (!this.map) return;
    this.mapTheme.theme = this.theme;
    // The popup reads from sources setStyle is about to drop, so it goes first
    this.destroyPopup();
    // The panel is still on screen over the window this opens, and a layer can't be styled inside it
    this.mapStyleLoaded = false;
    this.map.setStyle(this.mapTheme.getBaseMapStyle());
    // The same preview, drawn again into the style document the swap just emptied
    this.map.once('style.load', async () => await this.loadPreview());
  }

  // Surface MapLibre errors tied to the current preview, skipping the noise from basemap/glyph/
  // sprite loads, and deduped to a single alert per load attempt.
  protected handleMapError(event: maplibregl.ErrorEvent & { sourceId?: string }) {
    if (!this.previewer) return;
    // Everything else about the map: a style layer it refused, a glyph or sprite it couldn't fetch.
    // Held onto rather than reported, since only reportDroppedLayers can tell which of those it was.
    if (event.sourceId === undefined) this.lastStyleError = event.error;
    if (this.errorReported) return;
    if (!this.previewer.sourceIds.includes(event.sourceId ?? '')) return;
    this.reportError(event.error);
  }

  // Say so when the style doesn't hold layers the preview just asked it for. MapLibre does fire an
  // error for a layer it refuses, but on the map and with no sourceId, so handleMapError above reads
  // it as basemap noise - and having a listener at all is what stops MapLibre logging it itself, so
  // nothing reaches the console either. Left at that, a preview drawn in a color MapLibre can't parse
  // is a bare basemap that nobody is told anything about, in the alerts or in the console.
  //
  // So the reason is logged here alongside the ids, when the one we're holding is about a layer we
  // lost: MapLibre names the layer in the message it refused it with ("layers.<id>.paint.fill-color:
  // Could not parse color from value ''"). One naming none of them is a different failure - a glyph
  // that 404d - and saying it was why would send whoever reads it somewhere else entirely.
  private reportDroppedLayers() {
    const droppedLayerIds = this.previewer?.droppedLayerIds ?? [];
    if (droppedLayerIds.length === 0) return;

    const styleError = this.lastStyleError;
    const reason = styleError && droppedLayerIds.some(layerId => styleError.message.includes(layerId)) ? styleError.message : 'no reason given';
    console.error(`Layers refused by MapLibre while previewing ${this.previewer.url}:`, droppedLayerIds, reason);
    this.reportError(
      new Error("The map refused the layers this preview is drawn with, so it couldn't be shown. A style value it was given - most often a color - is one MapLibre can't use."),
    );
  }

  // Emit a single preview error per load attempt
  private reportError(error: unknown) {
    if (this.errorReported || !this.previewer) return;
    this.errorReported = true;
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

  // Fit the map to the given bounds; resolve once the move finishes
  async fitMapBounds(bounds: maplibregl.LngLatBoundsLike) {
    // The theme's gap, on all four edges, so a record's own edges read as edges instead of running
    // off the canvas. Only the theme's: what the sidebar covers is the map's own padding (see
    // onPaddingChange), and MapLibre already takes that off the space it fits bounds into.
    const padding = this.mapTheme.getPadding();
    if (!this.map.cameraForBounds(bounds, { padding })) return;
    return new Promise<void>(resolve => {
      this.map.once('moveend', () => resolve());
      this.map.fitBounds(bounds, { padding });
    });
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
  private recordLayerState(id: string, change: Partial<LayerState>): boolean {
    const layer = this.previewer?.previewLayers.find(previewLayer => previewLayer.id === id);
    if (!layer) return false;
    const current = this.layerState.get(id) ?? { visible: true, opacity: layer.defaultOpacity };
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

  // The layer panel is a sibling of #map rather than a MapLibre control, even though the button that
  // opens it is one. MapLibre owns the children of #map, so anything Stencil renders in there is
  // fighting it for the same DOM - the reason ogm-attributes has to be built by hand.
  //
  // Everything is wrapped in .container because that is where the Web Awesome scope has to go: the
  // classes waScope() applies are matched by the stylesheet linked above, and a plain class selector
  // in a shadow root's stylesheet never matches the host of that root. On the Host alone they would
  // establish nothing, which is what a bare <ogm-map> used to draw with - every color empty. The
  // panel needs them as much as the map does, and it isn't inside #map, so the scope goes above both.
  render() {
    return (
      <Host class={waScope(this.theme)}>
        <link rel="stylesheet" href={webAwesomeStylesheet()} />
        <div class={`container ${waScope(this.theme)}`}>
          <div id="map"></div>
          {this.layersPanelOpen && <ogm-layers theme={this.theme} layers={this.layerControls}></ogm-layers>}
        </div>
      </Host>
    );
  }
}
