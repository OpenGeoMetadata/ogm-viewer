import { Component, Element, h, Host, Prop, State, Watch } from '@stencil/core';
import type { LngLatBoundsLike, MapLibreMap } from 'maplibre-gl';

import AttributionControl from '../../lib/attribution-control';
import { fetchOrThrow, isWebGLError, recordError, WebGLUnavailableError, type PreviewError } from '../../lib/errors';
import { getElement } from '../../lib/elements';
import { WORLD } from '../../lib/geometry';
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
import type { MapProjection } from '../../lib/previewers/map';
import LocationPreviewer, { locationFor } from '../../lib/previewers/location';
import OgmRecord from '../../lib/record';
import { resolveRequest } from '../../lib/request';
import MapLibreTheme from '../../lib/themes/maplibre';

@Component({
  tag: 'ogm-locator',
  styleUrl: 'ogm-locator.css',
  shadow: true,
})
export class OgmLocator {
  @Element() el!: HTMLElement;
  @Prop() theme: 'light' | 'dark' = initialTheme(this.el);
  @Prop() darkBasemap?: string;
  @Prop() lightBasemap?: string;
  @Prop() record?: OgmRecord;
  @Prop() previewer?: LocationPreviewer; // Overrides record if passed

  @Prop() recordUrl?: string;

  /** Require a modifier for scrolling and two fingers for touch dragging. */
  @Prop() cooperativeGestures: boolean = true;
  @State() error?: PreviewError;

  private map: MapLibreMap;
  private mapTheme: MapLibreTheme;

  private mapStyleLoaded: boolean = false;

  // Keep the projection across basemap swaps, which otherwise reset it to the style default.
  private projection: MapProjection = 'globe';

  private drawn?: LocationPreviewer;

  componentWillLoad() {
    adoptWebAwesomeTheme(this.el);
    if (this.recordUrl) void this.fetchRecord();
  }

  async componentDidLoad() {
    const container = getElement(this.el, '#map');

    if (!this.el.isConnected) return;

    await whenSized(container);

    if (!this.el.isConnected) return;

    this.mapTheme = new MapLibreTheme(container, this.theme, { darkBasemap: this.darkBasemap, lightBasemap: this.lightBasemap });

    try {
      this.map = createMap(container, this.mapTheme, {
        ...LOCATION_MAP,
        cooperativeGestures: this.cooperativeGestures,
        attributionControl: false,
        ...openingLocation(container, this.mapTheme, this.opening(), this.projection === 'globe', { maxZoom: LOCATION_MAX_ZOOM }),
      });
    } catch (error) {
      if (!isWebGLError(error)) throw error;

      this.showError(new WebGLUnavailableError());
      return;
    }
    disableRotation(this.map);

    this.addControls();

    this.map.on('projectiontransition', this.handleProjectionTransition);

    this.map.on('style.load', () => this.handleStyleLoad());
  }

  disconnectedCallback() {
    if (this.map) this.map.remove();
  }

  private addControls() {
    addLocationControls(this.map);

    this.map.addControl(new AttributionControl({ compact: true }));
  }

  private async handleStyleLoad() {
    this.map.setSky(this.mapTheme.getSkyStyle());
    this.map.setProjection({ type: this.projection });
    this.mapStyleLoaded = true;
    await this.draw();
  }

  // Reframe for the new projection; globe and flat views can fit different extents.
  private handleProjectionTransition = async () => {
    if (!this.mapStyleLoaded) return;
    await this.frame();
  };

  @Watch('record')
  @Watch('previewer')
  protected async onRecordChange() {
    await this.clear();
    await this.draw();
  }

  @Watch('recordUrl')
  protected async onRecordUrlChange() {
    await this.fetchRecord();
  }

  private async fetchRecord() {
    if (!this.recordUrl) return;
    this.clearError();

    try {
      const { url, init } = resolveRequest(this.recordUrl, 'metadata');
      const response = await fetchOrThrow(url, init);
      this.record = new OgmRecord(await response.json());
    } catch (error) {
      console.error(`Error loading record ${this.recordUrl}:`, error);
      this.showError(recordError(error, this.recordUrl));
    }
  }

  private showError(error?: PreviewError) {
    if (!this.error?.fatal) this.error = error;
  }

  private clearError() {
    if (!this.error?.fatal) this.error = undefined;
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

  private async draw() {
    if (!this.map || !this.mapStyleLoaded) return;

    const style = this.mapTheme.getStyle();
    this.drawn = this.location();

    await this.drawn?.attach(this.map, style).preview();

    await this.frame();
  }

  private location(): LocationPreviewer | undefined {
    return this.previewer ?? (this.record && locationFor(this.record));
  }

  private opening(): LngLatBoundsLike {
    return this.location()?.declaredBounds ?? WORLD;
  }

  private async frame() {
    if (!this.map || !this.mapStyleLoaded) return;

    const extent = await this.drawn?.getBounds();
    await frameLocation(this.map, this.mapTheme, extent ?? WORLD, this.globe(), { maxZoom: LOCATION_MAX_ZOOM });
  }

  private globe(): boolean {
    return (readProjection(this.map) ?? this.projection) === 'globe';
  }

  private async clear() {
    await this.drawn?.clearPreview();
    this.drawn = undefined;
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
