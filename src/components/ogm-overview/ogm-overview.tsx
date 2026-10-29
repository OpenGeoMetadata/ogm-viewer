import { Component, Element, Event, EventEmitter, h, Host, Prop, State, Watch } from '@stencil/core';
import type { FitBoundsOptions, LngLatBounds, LngLatBoundsLike, MapLayerMouseEvent, MapLibreMap, Point } from 'maplibre-gl';

import { getElement } from '../../lib/elements';
import { isWebGLError, WebGLUnavailableError, type PreviewError } from '../../lib/errors';
import GeosearchControl from '../../lib/geosearch-control';
import { boundsToBbox, readBounds, unionBounds, WORLD } from '../../lib/geometry';
import { adoptWebAwesomeTheme, initialTheme, waScope } from '../../lib/init';
import {
  addLocationControls,
  createMap,
  disableRotation,
  frameLocation,
  LOCATION_MAP,
  LOCATION_MAX_ZOOM,
  openingLocation,
  readProjection,
  setBasemap,
  whenSized,
} from '../../lib/maps';
import LocationPreviewer, { locationsFor } from '../../lib/previewers/location';
import type { MapProjection } from '../../lib/previewers/map';
import type OgmRecord from '../../lib/record';
import { drawResults, RESULT_MARKERS } from '../../lib/results';
import MapLibreTheme from '../../lib/themes/maplibre';

const MIN_SEARCH_DRAG = 3;

@Component({
  tag: 'ogm-overview',
  styleUrl: 'ogm-overview.css',
  shadow: true,
})
export class OgmOverview {
  @Element() el!: HTMLElement;
  @Prop() theme: 'light' | 'dark' = initialTheme(this.el);
  @Prop() darkBasemap?: string;
  @Prop() lightBasemap?: string;
  @Prop() records?: OgmRecord[];

  @Prop() previewers?: (LocationPreviewer | undefined)[];

  /** One-based result number or record/resource ID; matching IDs take precedence. */
  @Prop() highlighted?: number | string;

  /** Enable shift-drag selection and report its area through boundsChange. */
  @Prop() geosearch: boolean = false;
  @Prop() searchHelpText: string = 'Shift + drag to search an area';

  /** Active search area as bounds or an ENVELOPE string; takes precedence over viewBounds. */
  @Prop() searchBounds?: LngLatBoundsLike | string;

  /** Exact opening bounds when no search or results supply an extent. */
  @Prop() viewBounds?: LngLatBoundsLike | string;

  /** Require a modifier for scrolling and two fingers for touch dragging. */
  @Prop() cooperativeGestures: boolean = true;

  @State() error?: PreviewError;

  @Event() boundsChange: EventEmitter<[number, number, number, number]>;

  /** Report pointer highlights as a one-based place and ID, or null when the pointer leaves. */
  @Event() highlightChange: EventEmitter<{ place: number; id: string } | null>;

  private map: MapLibreMap;
  private mapTheme: MapLibreTheme;
  private geosearchControl?: GeosearchControl;

  private mapStyleLoaded: boolean = false;

  // Keep the projection across basemap swaps, which otherwise reset it to the style default.
  private projection: MapProjection = 'globe';

  private extents: (LngLatBoundsLike | undefined)[] = [];
  private ids: string[] = [];

  private searchFilter?: LngLatBounds;

  private viewFilter?: LngLatBounds;

  private hovered?: number;

  componentWillLoad() {
    adoptWebAwesomeTheme(this.el);
  }

  async componentDidLoad() {
    const container = getElement(this.el, '#map');

    if (!this.el.isConnected) return;

    await whenSized(container);

    if (!this.el.isConnected) return;

    this.mapTheme = new MapLibreTheme(container, this.theme, { darkBasemap: this.darkBasemap, lightBasemap: this.lightBasemap });

    this.readSearchFilter();
    this.readViewFilter();
    this.extents = this.declaredExtents();

    try {
      this.map = createMap(container, this.mapTheme, {
        ...LOCATION_MAP,
        cooperativeGestures: this.cooperativeGestures,
        boxZoom: { boxZoomEnd: (_map, start, end) => this.search(start, end) },
        minZoom: 1,
        ...openingLocation(container, this.mapTheme, this.target(), this.projection === 'globe', this.camera()),
      });
    } catch (error) {
      if (!isWebGLError(error)) throw error;

      this.error = new WebGLUnavailableError();
      return;
    }
    disableRotation(this.map);

    this.addControls();
    this.followPointer();

    this.map.on('projectiontransition', this.handleProjectionTransition);

    this.map.on('style.load', () => this.handleStyleLoad());
  }

  // Wait a task before cleanup so Turbo can reconnect a permanent element during navigation.
  disconnectedCallback() {
    setTimeout(() => {
      if (!this.el.isConnected && this.map) this.map.remove();
    }, 0);
  }

  // Use layer hit testing so hovering matches the symbols MapLibre actually placed.
  private followPointer() {
    this.map.on('mousemove', RESULT_MARKERS, this.handlePointerOver);
    this.map.on('mouseleave', RESULT_MARKERS, this.handlePointerOut);
  }

  private handlePointerOver = (event: MapLayerMouseEvent) => {
    const places = (event.features ?? []).map(feature => Number(feature.properties?.label)).filter(place => Number.isInteger(place));
    this.setHovered(places.length ? Math.min(...places) : undefined);
  };

  private handlePointerOut = () => this.setHovered(undefined);

  private setHovered(place: number | undefined) {
    if (this.hovered === place) return;
    this.hovered = place;
    this.highlightChange.emit(this.hoveredResult());
    this.draw();
  }

  private hoveredResult(): { place: number; id: string } | null {
    return this.hovered === undefined ? null : { place: this.hovered, id: this.ids[this.hovered - 1] ?? '' };
  }

  private addControls() {
    addLocationControls(this.map);
    this.applyGeosearch();
  }

  private async handleStyleLoad() {
    this.map.setSky(this.mapTheme.getSkyStyle());
    this.map.setProjection({ type: this.projection });
    this.mapStyleLoaded = true;
    await this.load();
  }

  private handleProjectionTransition = async () => {
    if (!this.mapStyleLoaded) return;
    await this.frame();
  };

  @Watch('geosearch')
  protected onGeosearchChange() {
    this.applyGeosearch();
  }

  @Watch('searchHelpText')
  protected onSearchHelpTextChange() {
    this.geosearchControl?.setText(this.searchHelpText);
  }

  private applyGeosearch() {
    if (!this.map) return;

    if (this.geosearch) {
      this.map.boxZoom.enable();
    } else {
      // Reset an active drag before disabling its handler, or the rectangle and cursor remain.
      if (this.map.boxZoom.isActive()) this.map.boxZoom.reset();
      this.map.boxZoom.disable();
    }

    if (this.geosearchControl) {
      this.map.removeControl(this.geosearchControl);
      this.geosearchControl = undefined;
    }
    if (!this.geosearch) return;

    this.geosearchControl = new GeosearchControl(this.searchHelpText);

    this.map.addControl(this.geosearchControl, 'top-left');
  }

  // Determine west/east from screen order to preserve antimeridian crossings.
  // Sort latitudes separately because a globe view can cross a pole.
  private search(start: Point, end: Point) {
    if (start.dist(end) < MIN_SEARCH_DRAG) return;

    const topLeft = this.map.unproject([Math.min(start.x, end.x), Math.min(start.y, end.y)]);
    const bottomRight = this.map.unproject([Math.max(start.x, end.x), Math.max(start.y, end.y)]);
    const northWest = { lng: topLeft.lng, lat: Math.max(topLeft.lat, bottomRight.lat) };
    const southEast = { lng: bottomRight.lng, lat: Math.min(topLeft.lat, bottomRight.lat) };

    const area = readBounds([northWest.lng, southEast.lat, southEast.lng, northWest.lat]);
    if (!area) return console.warn('Could not read the area searched:', northWest, southEast);

    this.boundsChange.emit(boundsToBbox(area));
  }

  @Watch('records')
  @Watch('previewers')
  protected async onRecordsChange() {
    this.setHovered(undefined);
    await this.load();
  }

  @Watch('searchBounds')
  protected async onSearchBoundsChange() {
    this.readSearchFilter();
    this.draw();
    await this.frame();
  }

  @Watch('viewBounds')
  protected async onViewBoundsChange() {
    this.readViewFilter();
    await this.frame();
  }

  @Watch('highlighted')
  protected onHighlightedChange() {
    this.draw();
  }

  @Watch('theme')
  @Watch('darkBasemap')
  @Watch('lightBasemap')
  protected async onThemeChange() {
    if (!this.map) return;
    this.mapTheme.theme = this.theme;
    this.mapTheme.darkBasemap = this.darkBasemap;
    this.mapTheme.lightBasemap = this.lightBasemap;

    this.projection = readProjection(this.map) ?? this.projection;

    this.mapStyleLoaded = false;
    await setBasemap(this.map, this.mapTheme);
  }

  @Watch('cooperativeGestures')
  protected onCooperativeGesturesChange() {
    if (!this.map) return;
    if (this.cooperativeGestures) this.map.cooperativeGestures.enable();
    else this.map.cooperativeGestures.disable();
  }

  private async load() {
    this.readSearchFilter();
    this.readViewFilter();
    await this.measure();
    this.draw();
    await this.frame();
  }

  private readSearchFilter() {
    this.searchFilter = this.searchBounds === undefined ? undefined : readBounds(this.searchBounds);
    if (this.searchBounds !== undefined && !this.searchFilter) console.warn('Could not read searchBounds:', this.searchBounds);
  }

  private readViewFilter() {
    this.viewFilter = this.viewBounds === undefined ? undefined : readBounds(this.viewBounds);
    if (this.viewBounds !== undefined && !this.viewFilter) console.warn('Could not read viewBounds:', this.viewBounds);
  }

  private async measure() {
    const previewers = this.previewers ?? locationsFor(this.records ?? []);

    // Keep gaps aligned with the original results so IDs and marker numbers still name the same row.
    this.ids = this.previewers ? this.previewers.map(previewer => previewer?.resourceId ?? '') : (this.records ?? []).map(record => record.id);

    this.extents = await Promise.all(previewers.map(previewer => previewer?.getBounds()));
  }

  private declaredExtents(): (LngLatBoundsLike | undefined)[] {
    return (this.previewers ?? locationsFor(this.records ?? [])).map(previewer => previewer?.declaredBounds);
  }

  private draw() {
    if (!this.map || !this.mapStyleLoaded) return;

    drawResults(this.map, this.mapTheme.getStyle(), {
      extents: this.extents,
      highlighted: this.highlightedPositions(),
      searchBounds: this.searchFilter,
    });
  }

  private async frame() {
    if (!this.map || !this.mapStyleLoaded) return;

    await frameLocation(this.map, this.mapTheme, this.target(), this.globe(), this.camera());
  }

  private target(): LngLatBoundsLike {
    return this.searchFilter ?? unionBounds(this.extents) ?? this.viewFilter ?? WORLD;
  }

  private globe(): boolean {
    return (readProjection(this.map) ?? this.projection) === 'globe';
  }

  // Apply the zoom cap when framing results; explicit viewBounds must remain exact.
  private camera(): FitBoundsOptions {
    if (this.searchFilter) return { animate: true };
    if (!unionBounds(this.extents) && this.viewFilter) return { animate: true, padding: 0 };
    return { animate: true, maxZoom: LOCATION_MAX_ZOOM };
  }

  private highlightedPositions(): number[] {
    const places = [this.highlightedPosition(), this.hovered].filter(place => place !== undefined);
    return [...new Set(places)];
  }

  // Try IDs before numeric positions so a record named "1" wins over the first row.
  private highlightedPosition(): number | undefined {
    if (this.highlighted === undefined) return undefined;
    if (typeof this.highlighted === 'number') return this.position(this.highlighted);

    const named = this.ids.indexOf(this.highlighted);
    if (named >= 0) return named + 1;

    return this.position(Number(this.highlighted));
  }

  private position(place: number): number | undefined {
    return Number.isInteger(place) && place >= 1 && place <= this.extents.length ? place : undefined;
  }

  render() {
    return (
      <Host class={waScope(this.theme)}>
        <div id="map" class={waScope(this.theme)}></div>
        {this.error && <ogm-alerts theme={this.theme} error={this.error}></ogm-alerts>}
      </Host>
    );
  }
}
