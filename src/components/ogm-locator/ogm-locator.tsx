import { Component, Element, h, Host, Prop, Watch } from '@stencil/core';
import type maplibregl from 'maplibre-gl';

import AttributionControl from '../../lib/attribution-control';
import { fetchOrThrow } from '../../lib/errors';
import { getElement } from '../../lib/elements';
import { WORLD } from '../../lib/geometry';
import { initialTheme, waScope, webAwesomeReady, webAwesomeStylesheet } from '../../lib/init';
import { addLocationControls, createMap, disableRotation, frameLocation, LOCATION_MAP, LOCATION_MAX_ZOOM, readProjection, setBasemap, whenSized } from '../../lib/maps';
import type { MapProjection } from '../../lib/previewers/map';
import LocationPreviewer, { locationFor } from '../../lib/previewers/location';
import OgmRecord from '../../lib/record';
import { resolveRequest } from '../../lib/request';
import MapLibreTheme from '../../lib/themes/maplibre';

// A component for locating a single record on a map using its geometry
@Component({
  tag: 'ogm-locator',
  styleUrl: 'ogm-locator.css',
  shadow: true,
})
export class OgmLocator {
  @Element() el!: HTMLElement;
  @Prop() theme: 'light' | 'dark' = initialTheme(this.el);
  @Prop() record?: OgmRecord;
  @Prop() previewer?: LocationPreviewer; // Overrides record if passed

  // A URL to fetch an Aardvark record from - the same one <ogm-viewer> takes. Sets `record`.
  @Prop() recordUrl?: string;

  private map: maplibregl.Map;
  private mapTheme: MapLibreTheme;

  // Used to prevent trying to style layers before the map is ready
  private mapStyleLoaded: boolean = false;

  // Which projection to open a new style document in. Held only for that: a swap arrives flat,
  // because a style carries its own projection and neither basemap names one, so the map forgets what
  // the reader was looking at. Everything else asks the map - see readProjection.
  private projection: MapProjection = 'globe';

  // What is currently drawn, if there is anything to draw
  private drawn?: LocationPreviewer;

  componentWillLoad() {
    if (this.recordUrl) void this.fetchRecord();
  }

  async componentDidLoad() {
    const container = getElement(this.el, '#map');

    // Wait until we can read the palette CSS colors to draw
    await webAwesomeReady(getElement(this.el, 'link'), container);

    // Taken back off the page while we waited for it. Checked here as well as below, because the wait
    // below starts observing the container and only gives up once it has a box: a container that has
    // been detached will never get one, so a locator that came and went before its palette arrived
    // would leave an observer running behind it for good.
    if (!this.el.isConnected) return;

    // Wait until we're inside an element that actually has a box to draw the map
    // into, otherwise MapLibre will throw errors
    await whenSized(container);

    // Taken back off the page while we waited, so there is nothing left to build a map in
    if (!this.el.isConnected) return;

    this.mapTheme = new MapLibreTheme(container, this.theme);
    this.map = createMap(container, this.mapTheme, {
      ...LOCATION_MAP,
      // We handle this on our own so we can start it collapsed
      attributionControl: false,
    });
    disableRotation(this.map);

    // Before the style loads, because none of them writes anything into it
    this.addControls();

    // A reader reaching for the globe button, which is worth a fresh camera: what a globe can be
    // pointed at is not what a flat map can - see frameLocation - so flattening one is how a reader
    // sees the whole of a record too wide to fit on a sphere.
    this.map.on('projectiontransition', this.handleProjectionTransition);

    // Everything below lives in the style document, so all of it is done again for each new one: once
    // at first load, and again after every theme swap.
    this.map.on('style.load', () => this.handleStyleLoad());
  }

  // Clean up the map to prevent warnings/errors when removed from the DOM
  disconnectedCallback() {
    if (this.map) this.map.remove();
  }

  private addControls() {
    addLocationControls(this.map);

    // Bottom right, which is where MapLibre's own would have gone
    this.map.addControl(new AttributionControl({ compact: true }));
  }

  // Called on first load and every time the theme is changed. We use the
  // projection we remembered here to keep it the same; everything else gets
  // redrawn from scratch.
  private async handleStyleLoad() {
    this.map.setSky(this.mapTheme.getSkyStyle());
    this.map.setProjection({ type: this.projection });
    this.mapStyleLoaded = true;
    await this.draw();
  }

  /**
   * The projection changing under the camera, which is worth a fresh one: what a globe can be pointed
   * at is not what a flat map can - see frameLocation - so flattening one is how a reader sees the
   * whole of something too wide to fit on a sphere.
   *
   * Nothing is remembered here, because this event can't say who caused it. A reader pressing the
   * globe button and a style document naming its own projection on the way in arrive as the same
   * thing, and no flag holds them apart: a swap asked for while the map is still loading the document
   * before it lands that reset squarely inside any window this could call the reader's. What to put
   * back after a swap is read off the map instead, at the point the swap starts - see onThemeChange.
   */
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

  // Left unset rather than thrown on failure: unlike <ogm-viewer>, this has nowhere to show an error.
  private async fetchRecord() {
    if (!this.recordUrl) return;

    try {
      const { url, init } = resolveRequest(this.recordUrl, 'metadata');
      const response = await fetchOrThrow(url, init);
      this.record = new OgmRecord(await response.json());
    } catch (error) {
      console.error(`Error loading record ${this.recordUrl}:`, error);
    }
  }

  // When the theme changes, swap the basemap to match, then draw the same location into the style
  // document the swap just emptied.
  @Watch('theme')
  protected async onThemeChange() {
    if (!this.map) return;
    this.mapTheme.theme = this.theme;

    // Read now, while the map still knows: the document replacing this one names its own projection
    // and neither basemap names anything, so the map comes back flat unless it is put back.
    this.projection = readProjection(this.map) ?? this.projection;

    this.mapStyleLoaded = false;
    await setBasemap(this.map, this.mapTheme);
    // style.load has already fired by the time this resolves, and it draws - so there is nothing
    // to do here but let it. Kept as an await so a caller can wait for the swap to finish.
  }

  // Put the record's location on the map, and point the map at it
  private async draw() {
    if (!this.map || !this.mapStyleLoaded) return;

    // Only known now: the colors come out of the theme, and the theme can change under a location
    // that is already on screen.
    const style = this.mapTheme.getStyle();
    this.drawn = this.previewer ?? (this.record && locationFor(this.record));

    // Nothing here reaches the network - a LocationResource is built from a shape rather than a URL
    await this.drawn?.attach(this.map, style).preview();

    await this.frame();
  }

  // Point the camera at what was drawn, or at the world when there was nothing to draw
  private async frame() {
    if (!this.map || !this.mapStyleLoaded) return;

    const extent = await this.drawn?.getBounds();
    await frameLocation(this.map, this.mapTheme, extent ?? WORLD, this.globe(), { maxZoom: LOCATION_MAX_ZOOM });
  }

  // Whether the camera is pointing at a sphere, which is what decides whether what it is pointed at
  // has to be held to the half of the world facing it. Asked of the map, because the map is the one
  // that knows: a reader can change this without anything here being told which way it went.
  private globe(): boolean {
    return (readProjection(this.map) ?? this.projection) === 'globe';
  }

  // Take the last location back off the map
  private async clear() {
    await this.drawn?.clearPreview();
    this.drawn = undefined;
  }

  // Web Awesome is linked even though nothing here renders a wa-* element: MapLibreTheme reads
  // --wa-color-* tokens for the shape it draws and the stylesheet reads them for MapLibre's own
  // chrome, and this component is only ever used on its own, so it is always the one establishing
  // them.
  render() {
    return (
      <Host class={waScope(this.theme)}>
        <link rel="stylesheet" href={webAwesomeStylesheet()} />
        <div id="map" class={waScope(this.theme)}></div>
      </Host>
    );
  }
}
