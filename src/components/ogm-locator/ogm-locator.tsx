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

/**
 * Where one record is, on a map of its own: the geometry the record carries, or the box around it if
 * that is all the record has. The map GeoBlacklight draws with Leaflet beside a record's metadata.
 *
 * One record, or one location built by hand, and nothing else. Several of them at once is a different
 * question with different answers - which of them is which, and what a reader is meant to compare -
 * and <ogm-overview> is where those are answered.
 */
@Component({
  tag: 'ogm-locator',
  styleUrl: 'ogm-locator.css',
  shadow: true,
})
export class OgmLocator {
  @Element() el: HTMLElement;
  @Prop() theme: 'light' | 'dark' = themePreference();

  // The record to place. A DOM property rather than an attribute: an OgmRecord doesn't survive being
  // written as one.
  @Prop() record?: OgmRecord;

  // A location built by hand, for an application that has one already. Takes the place of `record`,
  // which is then not read at all - the same arrangement <ogm-previews> has with its own two.
  @Prop() previewer?: LocationPreviewer;

  private map: maplibregl.Map;
  private mapTheme: MapLibreTheme;

  // Used to prevent drawing into a style document that isn't there yet
  private mapStyleLoaded: boolean = false;

  // Which projection the map is in, as the reader last left it. Held rather than read off the map,
  // because the map forgets: a style document carries its own projection and neither basemap names
  // one, so every theme swap arrives flat and would take a globe the reader had chosen with it.
  // A globe to start with, because one place on a sphere reads better than one place on a rectangle,
  // and the button to flatten it is right there.
  private projection: MapProjection = 'globe';

  // What is currently drawn, if there is anything to draw
  private drawn?: LocationPreviewer;

  async componentDidLoad() {
    const container = getElement(this.el, '#map');

    // Held until that palette has actually arrived. Once, here, rather than before each draw: the
    // map is built after it, so nothing that gets drawn on the map can be early.
    await webAwesomeReady(getElement(this.el, 'link'), container);

    // Taken back off the page while we waited for it. Checked here as well as below, because the wait
    // below starts observing the container and only gives up once it has a box: a container that has
    // been detached will never get one, so a locator that came and went before its palette arrived
    // would leave an observer running behind it for good.
    if (!this.el.isConnected) return;

    // And until there is a box to build the map into; see whenSized. A locator is as likely as a
    // preview to be mounted inside something hidden, and draw() answers for having no map yet.
    await whenSized(container);

    // Taken back off the page while we waited, so there is nothing left to build a map in
    if (!this.el.isConnected) return;

    this.mapTheme = new MapLibreTheme(container, this.theme);
    this.map = createMap(container, this.mapTheme, {
      ...LOCATION_MAP,
      // Ours instead, added below: MapLibre's opens the credit panel as soon as CARTO's arrives, and
      // a map this size has no corner to spare for it. See AttributionControl.
      attributionControl: false,
      // MapLibre offers shift+drag as a zoom by default. On a map whose whole contract is that it
      // frames what it drew, that is a camera the reader can move somewhere arbitrary with nothing
      // to bring it back. <ogm-overview> keeps the gesture and spends it on a search instead.
      boxZoom: false,
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

  // A new style document, which arrives empty: at first load, and again after every theme swap.
  //
  // The projection is set here rather than by the camera. A style carries its own and neither basemap
  // names one, so each document opens flat until this says otherwise; setting it per camera instead
  // would stamp over the reader's press every time a new record was drawn. It can't happen any
  // earlier either - setProjection throws before a style has loaded - and it happens before the flag
  // goes up, so that neither MapLibre's reset nor this correction of it is mistaken for the reader
  // reaching for the button. The draw below is what frames.
  private async handleStyleLoad() {
    this.map.setSky(this.mapTheme.getSkyStyle());
    this.map.setProjection({ type: this.projection });
    this.mapStyleLoaded = true;
    await this.draw();
  }

  // The reader reaching for the globe button.
  //
  // Held to a style document that is already up, because a style loading is itself two of these: it
  // ends by setting whatever projection it names, which is mercator for both basemaps, and then
  // handleStyleLoad above puts the reader's choice back. Neither is a choice, and taking the first
  // for one would flatten a globe on every theme swap - which is what it did.
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

  // Point the camera at what was drawn, or at the world when there was nothing to draw. A record with
  // no geometry is ordinary metadata rather than a broken record, so what it gets is a map of
  // everywhere rather than an empty pane or a complaint.
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
