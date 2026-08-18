import { Component, Element, h, Host, Prop, Watch } from '@stencil/core';
import type maplibregl from 'maplibre-gl';

import { getElement } from '../../lib/elements';
import { clampToHemisphere, unionBounds, WORLD } from '../../lib/geometry';
import { themePreference, waScope, webAwesomeReady, webAwesomeStylesheet } from '../../lib/init';
import { createMap, fitBounds, setBasemap, whenSized } from '../../lib/maps';
import LocationPreviewer, { locationsFor } from '../../lib/previewers/location';
import type OgmRecord from '../../lib/record';
import MapLibreTheme from '../../lib/themes/maplibre';

// We need to ensure that there are identifiable features around to read so
// that the location of the data is clear; no point zooming in any further than
// this because the map may be missing names for cities, towns, etc.
const MAX_ZOOM = 12;

/**
 * Display the location of one or several records (or previewers) by drawing
 * their geometry or basic bounding boxes.
 */
@Component({
  tag: 'ogm-overview',
  styleUrl: 'ogm-overview.css',
  shadow: true,
})
export class OgmOverview {
  @Element() el: HTMLElement;
  @Prop() theme: 'light' | 'dark' = themePreference();
  @Prop() records?: OgmRecord[];
  @Prop() previewers?: LocationPreviewer[];

  private map: maplibregl.Map;
  private mapTheme: MapLibreTheme;

  // Used to prevent drawing into a style document that isn't there yet
  private mapStyleLoaded: boolean = false;

  // Things currently drawn to the map
  private drawn: (LocationPreviewer | undefined)[] = [];

  async componentDidLoad() {
    const container = getElement(this.el, '#map');

    // Held until that palette has actually arrived. Once, here, rather than before each draw: the
    // map is built after it, so nothing that gets drawn on the map can be early.
    await webAwesomeReady(getElement(this.el, 'link'), container);

    // And until there is a box to build the map into; see whenSized. An overview is as likely as a
    // preview to be mounted inside something hidden, and draw() answers for having no map yet.
    await whenSized(container);

    // Taken back off the page while we waited, so there is nothing left to build a map in
    if (!this.el.isConnected) return;

    this.mapTheme = new MapLibreTheme(container, this.theme);
    this.map = createMap(container, this.mapTheme, {
      cooperativeGestures: true,
      dragRotate: false,
      touchPitch: false,
      minZoom: 0,
    });
    this.map.keyboard.disableRotation();
    this.map.touchZoomRotate.disableRotation();

    // Everything below lives in the style document, so all of it is drawn again for each new one:
    // once at first load, and again after every theme swap. The projection goes with it - a style
    // carries its own and neither basemap names one - which is why draw() sets it rather than this
    // does. Either way it can't be set any earlier: setProjection throws before a style has loaded.
    this.map.on('style.load', async () => {
      this.mapStyleLoaded = true;
      this.map.setSky(this.mapTheme.getSkyStyle());
      await this.draw();
    });
  }

  // Clean up the map to prevent warnings/errors when removed from the DOM
  disconnectedCallback() {
    if (this.map) this.map.remove();
  }

  @Watch('records')
  @Watch('previewers')
  protected async onRecordsChange() {
    await this.clear();
    await this.draw();
  }

  // When the theme changes, swap the basemap to match, then draw the same records into the style
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

  // Put every record's extent on the map, number them, and zoom to fit.
  private async draw() {
    if (!this.map || !this.mapStyleLoaded) return;

    // Only known now: the colors come out of the theme, and the theme can change under records
    // that are already on screen.
    const style = this.mapTheme.getStyle();
    this.drawn = this.previewers ?? locationsFor(this.records ?? []);

    // In the order given, so the boxes are painted in the same order they're numbered. Nothing here
    // reaches the network - a LocationResource is built from a shape rather than a URL - so
    // drawing them one after another costs nothing.
    for (const previewer of this.drawn) await previewer?.attach(this.map, style).preview();

    // Last, so every number sits over every box
    const extents = await Promise.all(this.drawn.map(previewer => previewer?.getBounds()));

    // A globe when there is one place to look at, and a flat map when there are several
    const placed = extents.filter(extent => extent !== undefined);
    const globe = placed.length === 1;
    this.map.setProjection({ type: globe ? 'globe' : 'mercator' });

    // Zoom to the superset of all bounds (or the whole world if none).
    // For a globe, clamp to a hemisphere so that the camera can properly frame it.
    //
    // The theme's overview gap rather than the one a preview gets: this is a whole map read at once
    // rather than a pane filled with one record, and a box drawn against its edge reads as running
    // off it - on a globe, that edge is where the sphere turns away.
    const target = unionBounds(extents) ?? WORLD;
    await fitBounds(this.map, this.mapTheme, globe ? clampToHemisphere(target) : target, { maxZoom: MAX_ZOOM, padding: style.overviewPadding });
  }

  // Take the last set of records back off the map
  private async clear() {
    await Promise.all(this.drawn.map(previewer => previewer?.clearPreview()));
    this.drawn = [];
  }

  // Web Awesome is linked even though nothing here renders a wa-* element: MapLibreTheme reads
  // --wa-color-* tokens for the boxes and the numbers, and this component is meant to be used on
  // its own, so it is the one that has to establish them.
  render() {
    return (
      <Host class={waScope(this.theme)}>
        <link rel="stylesheet" href={webAwesomeStylesheet()} />
        <div id="map" class={waScope(this.theme)}></div>
      </Host>
    );
  }
}
