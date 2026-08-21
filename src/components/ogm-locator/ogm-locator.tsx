import { Component, Element, h, Host, Prop, Watch } from '@stencil/core';
import type maplibregl from 'maplibre-gl';

import AttributionControl from '../../lib/attribution-control';
import { getElement } from '../../lib/elements';
import { WORLD } from '../../lib/geometry';
import { themePreference, waScope, webAwesomeReady, webAwesomeStylesheet } from '../../lib/init';
import { addLocationControls, createMap, disableRotation, frameLocation, LOCATION_MAP, LOCATION_MAX_ZOOM, setBasemap, whenSized } from '../../lib/maps';
import type { MapProjection } from '../../lib/previewers/map';
import LocationPreviewer, { locationFor } from '../../lib/previewers/location';
import type OgmRecord from '../../lib/record';
import MapLibreTheme from '../../lib/themes/maplibre';

// A component for locating a single record on a map using its geometry
@Component({
  tag: 'ogm-locator',
  styleUrl: 'ogm-locator.css',
  shadow: true,
})
export class OgmLocator {
  @Element() el: HTMLElement;
  @Prop() theme: 'light' | 'dark' = themePreference();
  @Prop() record?: OgmRecord;
  @Prop() previewer?: LocationPreviewer; // Overrides record if passed

  private map: maplibregl.Map;
  private mapTheme: MapLibreTheme;

  // Used to prevent trying to style layers before the map is ready
  private mapStyleLoaded: boolean = false;

  // We track this so it survives theme/basemap swaps; MapLibre doesn't track it
  private projection: MapProjection = 'globe';

  // What is currently drawn, if there is anything to draw
  private drawn?: LocationPreviewer;

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

  // Called when you click the globe. We remember the projection you chose, and
  // also reframe everything to match the new projection.
  private handleProjectionTransition = async (event: maplibregl.MapProjectionEvent) => {
    if (!this.mapStyleLoaded) return;

    // Anything that isn't flat is a globe as far as the camera is concerned. MapLibre has two names
    // for one: 'globe' is the projection that draws as a sphere until it is zoomed in past the point
    // where a sphere and a flat map are the same picture, and 'vertical-perspective' is the one that
    // stays a sphere throughout.
    this.projection = event.newProjection === 'mercator' ? 'mercator' : 'globe';
    await this.frame();
  };

  @Watch('record')
  @Watch('previewer')
  protected async onRecordChange() {
    await this.clear();
    await this.draw();
  }

  // When the theme changes, swap the basemap to match, then draw the same location into the style
  // document the swap just emptied.
  @Watch('theme')
  protected async onThemeChange() {
    if (!this.map) return;
    this.mapTheme.theme = this.theme;
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
    await frameLocation(this.map, this.mapTheme, extent ?? WORLD, this.projection === 'globe', { maxZoom: LOCATION_MAX_ZOOM });
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
