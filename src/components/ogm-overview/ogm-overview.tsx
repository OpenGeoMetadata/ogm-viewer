import { Component, Element, Event, EventEmitter, h, Host, Prop, Watch } from '@stencil/core';
import type maplibregl from 'maplibre-gl';

import { getElement } from '../../lib/elements';
import GeosearchControl from '../../lib/geosearch-control';
import { boundsToBbox, clampToHemisphere, unionBounds, WORLD } from '../../lib/geometry';
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

  // Whether to offer to search the area on screen, and which of the two ways to start out doing it:
  // 'auto' searches every view the reader comes to rest in, 'manual' only the ones they ask about.
  // Left unset there is no control and no event, which is what an overview that isn't a set of search
  // results wants.
  @Prop() geosearch?: 'auto' | 'manual';

  // What that control says in each mode. Given rather than fixed because GeoBlacklight already
  // translates both before handing them to the Leaflet control this one stands in for.
  @Prop() searchHereText: string = 'Search here';
  @Prop() searchOnMoveText: string = 'Search when I move the map';

  // Where the reader has asked to search, as the west, south, east, north degrees a query states -
  // see boundsToBbox. Nothing here answers it: what a new area means is the embedding page's to say.
  @Event() boundsChange: EventEmitter<[number, number, number, number]>;

  private map: maplibregl.Map;
  private mapTheme: MapLibreTheme;
  private geosearchControl?: GeosearchControl;

  // Used to prevent drawing into a style document that isn't there yet
  private mapStyleLoaded: boolean = false;

  // Things currently drawn to the map
  private drawn: (LocationPreviewer | undefined)[] = [];

  async componentDidLoad() {
    const container = getElement(this.el, '#map');

    // Held until that palette has actually arrived. Once, here, rather than before each draw: the
    // map is built after it, so nothing that gets drawn on the map can be early.
    await webAwesomeReady(getElement(this.el, 'link'), container);

    // Taken back off the page while we waited for it. Checked here as well as below, because the wait
    // below starts observing the container and only gives up once it has a box: a container that has
    // been detached will never get one, so an overview that came and went before its palette arrived
    // would leave an observer running behind it for good. Unlike <ogm-map>, which asks for the palette
    // without waiting on it here, this is a later task than the one that rendered - so there is a real
    // gap for the element to go missing in.
    if (!this.el.isConnected) return;

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

    // Before the style loads, because the control draws nothing into it and asks the map for nothing
    // but its bounds - and those only once the reader has moved it
    this.addGeosearch();

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

  // Added and taken off rather than hidden the way <ogm-map>'s controls are: this is the only thing in
  // its corner, so there is no stack for it to come back to the bottom of - and going means its
  // bindings to the map go with it. A change of starting mode arrives the same way, as a fresh control.
  @Watch('geosearch')
  protected onGeosearchChange() {
    if (!this.map) return;

    if (this.geosearchControl) {
      this.map.removeControl(this.geosearchControl);
      this.geosearchControl = undefined;
    }

    this.addGeosearch();
  }

  // Retexted where it stands, so a change of wording doesn't put the control back into the mode it
  // started in or interrupt a reader partway through using it
  @Watch('searchHereText')
  @Watch('searchOnMoveText')
  protected onGeosearchLabelsChange() {
    this.geosearchControl?.setLabels({ searchHere: this.searchHereText, searchOnMove: this.searchOnMoveText });
  }

  private addGeosearch() {
    if (!this.map || !this.geosearch) return;

    this.geosearchControl = new GeosearchControl(() => this.emitBounds(), { searchHere: this.searchHereText, searchOnMove: this.searchOnMoveText }, this.geosearch);

    // Top left, which is empty: the attribution this map's only other control draws sits bottom right
    this.map.addControl(this.geosearchControl, 'top-left');
  }

  // Read when the control asks rather than when the camera stopped, so what gets searched is where the
  // map came to rest even if a wait started partway through getting there
  private emitBounds() {
    if (!this.map) return;
    this.boundsChange.emit(boundsToBbox(this.map.getBounds()));
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
