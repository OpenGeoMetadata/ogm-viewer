import { Component, Element, Event, EventEmitter, h, Host, Prop, Watch } from '@stencil/core';
import type maplibregl from 'maplibre-gl';

import { getElement } from '../../lib/elements';
import GeosearchControl from '../../lib/geosearch-control';
import { boundsToBbox, readBounds, unionBounds, WORLD } from '../../lib/geometry';
import { themePreference, waScope, webAwesomeReady, webAwesomeStylesheet } from '../../lib/init';
import { addLocationControls, createMap, disableRotation, frameLocation, LOCATION_MAP, LOCATION_MAX_ZOOM, setBasemap, whenSized } from '../../lib/maps';
import LocationPreviewer, { locationsFor } from '../../lib/previewers/location';
import type { MapProjection } from '../../lib/previewers/map';
import type OgmRecord from '../../lib/record';
import { drawResults, RESULT_MARKERS } from '../../lib/results';
import MapLibreTheme from '../../lib/themes/maplibre';

// How far a shift-drag has to go before it counts as asking about an area, in pixels. MapLibre's own
// line between a click and a drag, and the point at which it starts drawing the rectangle: under it
// the reader saw no box at all, and a search they got no sight of is one they didn't ask for. MapLibre
// reports the gesture anyway - only an exactly stationary mouseup is called off - so the floor is ours
// to hold.
const MIN_SEARCH_DRAG = 3;

/**
 * Where several records are: one numbered marker apiece, and optionally a way to search the map for
 * more of them.
 *
 * Nothing of a record is drawn but its number. A page of boxes says less than a page of numbers a
 * reader can find again in the list beside the map, and the only two boxes worth drawing are the ones
 * that answer a question: which area is being searched, and where the one result something outside has
 * pointed at actually is. For a single record on a map of its own, see <ogm-locator>.
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

  // Holes and all, because that is what `locationsFor` hands back: a record with nothing to place it
  // by still holds its position, since that position is the number a reader sees beside the map.
  @Prop() previewers?: (LocationPreviewer | undefined)[];

  /**
   * Which result to bring forward, as either its place in the list counted from one or the id of the
   * record - or of the resource a previewer draws - that it came from. An attribute hands over a
   * string for either, since an attribute is always one.
   *
   * The marker changes color and comes to the front, and the result's own extent is drawn around it.
   * The camera doesn't move: something on the page has said which result matters, not where to look.
   *
   * A reader's pointer over a number does the same thing without being asked, so both can be true at
   * once - of two different results, if a page names one while the pointer is over another. Each is a
   * way of saying the same thing about a row, so each gets the same drawing; see draw.
   */
  @Prop() highlighted?: number | string;

  /**
   * Whether a reader can search the map by holding shift and dragging a box over it. The area they
   * drew is reported through `boundsChange`; nothing here answers it, because what a new area means
   * is the embedding page's to say. The help text is a prop because GeoBlacklight runs the strings
   * for the control this replaces through Rails I18n.
   */
  @Prop() geosearch: boolean = false;
  @Prop() searchHelpText: string = 'Shift + drag to search an area';

  /**
   * The area a search is currently filtered to, drawn as a box and framed by the camera. Given as the
   * west, south, east, north degrees `boundsChange` reports, as an ENVELOPE string in the form
   * `dcat_bbox` holds one, or as anything else MapLibre reads as bounds. A string is read from an
   * attribute, so a page rendered by a server can say what its map is filtered to without any
   * JavaScript at all.
   *
   * It goes on holding: whenever what is drawn changes, the camera returns here rather than
   * re-framing itself around the new set of results. Leave it unset for a map that should look at
   * whatever it has been given.
   */
  @Prop() bounds?: maplibregl.LngLatBoundsLike | string;

  // Where the reader has asked to search, as the west, south, east, north degrees a query states -
  // see boundsToBbox. Nothing here answers it: what a new area means is the embedding page's to say.
  @Event() boundsChange: EventEmitter<[number, number, number, number]>;

  private map: maplibregl.Map;
  private mapTheme: MapLibreTheme;
  private geosearchControl?: GeosearchControl;

  // Used to prevent drawing into a style document that isn't there yet
  private mapStyleLoaded: boolean = false;

  // Which projection the map is in, as the reader last left it. Held rather than read off the map,
  // because the map forgets: a style document carries its own projection and neither basemap names
  // one, so every theme swap arrives flat and would take a globe the reader had chosen with it.
  private projection: MapProjection = 'globe';

  // Where every result is and what each of them is called, in the order they were given - including
  // the ones nobody could place, which keep their position in both. See highlightedPosition.
  private extents: (maplibregl.LngLatBoundsLike | undefined)[] = [];
  private ids: string[] = [];

  // The area a search is filtered to, as this map can read it. Held rather than read where it is
  // used: it is wanted twice on every draw, once for the box and once for the camera, and reading it
  // twice would report an unreadable one twice as well.
  private searchFilter?: maplibregl.LngLatBounds;

  // Which result the reader's pointer is over, as its place in the list counted from one. Ours rather
  // than the page's: nothing outside can see a pointer land on a number drawn inside this shadow root.
  private hovered?: number;

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
      ...LOCATION_MAP,
      // Always handed over, even with geosearch switched off: MapLibre reads this once as the handler
      // is built and offers no way to hand it one later, so the offer has to be made now and taken
      // back by disabling the handler - see applyGeosearch. Making it at all is also what stops a
      // shift-drag flying the camera to whatever it enclosed. A search shouldn't move the map, and the
      // area worth reporting is the box the reader drew rather than the wider view a fit to it settles
      // on: their box never has the canvas' own shape, so the camera always covers more than they
      // asked about.
      boxZoom: { boxZoomEnd: (_map, start, end) => this.search(start, end) },
    });
    disableRotation(this.map);

    // Before the style loads, because none of these writes anything into it - and the pointer can be
    // followed before there are any markers for it to find, since a layer listener is the map's own
    this.addControls();
    this.followPointer();

    // A reader reaching for the globe button, which is worth a fresh camera: what a globe can be
    // pointed at is not what a flat map can - see frameLocation - so flattening one is how a reader
    // sees the whole of a set of results too wide to fit on a sphere.
    this.map.on('projectiontransition', this.handleProjectionTransition);

    // Everything below lives in the style document, so all of it is done again for each new one: once
    // at first load, and again after every theme swap.
    this.map.on('style.load', () => this.handleStyleLoad());
  }

  // Clean up the map to prevent warnings/errors when removed from the DOM
  disconnectedCallback() {
    if (this.map) this.map.remove();
  }

  /**
   * Highlight whichever number the reader's pointer is over.
   *
   * Bound to the layer rather than to the map, so MapLibre does the hit testing against the symbols it
   * actually placed - and bound once, before any of them exist, because a layer listener is the map's
   * own and goes on answering for every style document that follows. Nothing here moves the camera or
   * tells the page: a pointer resting on a number is a question about that number, not a click.
   *
   * mousemove rather than mouseenter, because the pointer can cross from one marker straight onto the
   * next without ever leaving the layer, and mouseenter is only offered the first of those.
   */
  private followPointer() {
    this.map.on('mousemove', RESULT_MARKERS, this.handlePointerOver);
    this.map.on('mouseleave', RESULT_MARKERS, this.handlePointerOut);
  }

  // The number under the pointer, which is the one the reader can see: markers overlap, and the one
  // drawn on top is the earliest, since that is how they are sorted - see resultMarkersLayer. MapLibre
  // hands back everything under the pointer without promising an order, so the choice is made here
  // rather than taken from the first of them.
  private handlePointerOver = (event: maplibregl.MapLayerMouseEvent) => {
    const places = (event.features ?? []).map(feature => Number(feature.properties?.label)).filter(place => Number.isInteger(place));
    this.setHovered(places.length ? Math.min(...places) : undefined);
  };

  private handlePointerOut = () => this.setHovered(undefined);

  // Redrawn only when the answer changes, since the pointer reports every pixel it crosses
  private setHovered(place: number | undefined) {
    if (this.hovered === place) return;
    this.hovered = place;
    this.draw();
  }

  // Zoom buttons and the projection toggle, plus the search hint if one was asked for
  private addControls() {
    addLocationControls(this.map);
    this.applyGeosearch();
  }

  // A new style document, which arrives empty: at first load, and again after every theme swap.
  //
  // The projection is set here rather than by the camera. A style carries its own and neither basemap
  // names one, so each document opens flat until this says otherwise; setting it per camera instead
  // would stamp over the reader's press every time the results changed. It can't happen any earlier
  // either - setProjection throws before a style has loaded - and it happens before the flag goes up,
  // so that neither MapLibre's reset nor this correction of it is mistaken for the reader reaching for
  // the button. The load below is what draws and frames.
  private async handleStyleLoad() {
    this.map.setSky(this.mapTheme.getSkyStyle());
    this.map.setProjection({ type: this.projection });
    this.mapStyleLoaded = true;
    await this.load();
  }

  // The reader reaching for the globe button.
  //
  // Held to a style document that is already up, because a style loading is itself two of these: it
  // ends by setting whatever projection it names, which is mercator for both basemaps, and then
  // handleStyleLoad above puts the reader's choice back. Neither is a choice, and taking the first for
  // one would flatten a globe on every theme swap.
  private handleProjectionTransition = async (event: maplibregl.MapProjectionEvent) => {
    if (!this.mapStyleLoaded) return;

    // Anything that isn't flat is a globe as far as the camera is concerned. MapLibre has two names
    // for one: 'globe' is the projection that draws as a sphere until it is zoomed in past the point
    // where a sphere and a flat map are the same picture, and 'vertical-perspective' is the one that
    // stays a sphere throughout.
    this.projection = event.newProjection === 'mercator' ? 'mercator' : 'globe';
    await this.frame();
  };

  // Added and taken off rather than hidden the way <ogm-map>'s controls are: this is the only thing in
  // its corner, so there is no stack for it to come back to the bottom of - and going means its
  // bindings to the map go with it. The gesture is switched on and off rather than rebuilt, because
  // MapLibre reads the callback behind it once, as the handler is built.
  @Watch('geosearch')
  protected onGeosearchChange() {
    this.applyGeosearch();
  }

  // Retexted where it stands, so a change of wording doesn't interrupt a reader partway through a box
  @Watch('searchHelpText')
  protected onSearchHelpTextChange() {
    this.geosearchControl?.setText(this.searchHelpText);
  }

  private applyGeosearch() {
    if (!this.map) return;

    if (this.geosearch) {
      this.map.boxZoom.enable();
    } else {
      // Reset before disabling, or a gesture caught halfway leaves its rectangle and the crosshair
      // cursor behind: a disabled handler stops being offered the mouseup that would have cleared
      // them, and nothing short of the window losing focus does it instead.
      if (this.map.boxZoom.isActive()) this.map.boxZoom.reset();
      this.map.boxZoom.disable();
    }

    if (this.geosearchControl) {
      this.map.removeControl(this.geosearchControl);
      this.geosearchControl = undefined;
    }
    if (!this.geosearch) return;

    this.geosearchControl = new GeosearchControl(this.searchHelpText);

    // Top left, which is empty: the zoom and globe buttons are top right, and the attribution both
    // basemaps require is bottom right
    this.map.addControl(this.geosearchControl, 'top-left');
  }

  /**
   * What the reader drew, as an area a query can state.
   *
   * The two corners arrive as pixels on the canvas, so which is west is decided on screen rather than
   * by longitude. With rotation disabled the left edge is always the west one, and it has to be read
   * that way round: a box dragged across the antimeridian unprojects to 175 and -175, and taking the
   * smaller of those for west would describe the other 350 degrees. Screen y grows downward, so the
   * top of the box is its north edge.
   *
   * On a globe those two corners aren't the corners of a rectangle at all - the top edge of a screen
   * box isn't a line of latitude - but they are what the reader enclosed, and they are the same two
   * points MapLibre's own box zoom would have fitted.
   *
   * The latitudes are sorted afterwards, unlike the longitudes. Screen y and latitude only run
   * together while the pole is off screen: pan one into view on a globe and a line of pixels crosses
   * it, so the higher pixel can be the lower latitude, and a box dragged over the pole would come out
   * with its south edge north of its north edge. Nothing rejects that - LngLatBounds holds whichever
   * corners it is given - so it would leave here as a bbox no query can answer.
   */
  private search(start: maplibregl.Point, end: maplibregl.Point) {
    if (start.dist(end) < MIN_SEARCH_DRAG) return;

    const topLeft = this.map.unproject([Math.min(start.x, end.x), Math.min(start.y, end.y)]);
    const bottomRight = this.map.unproject([Math.max(start.x, end.x), Math.max(start.y, end.y)]);
    const northWest = { lng: topLeft.lng, lat: Math.max(topLeft.lat, bottomRight.lat) };
    const southEast = { lng: bottomRight.lng, lat: Math.min(topLeft.lat, bottomRight.lat) };

    // Through our own reader rather than straight into a LngLatBounds: it carries an east edge past
    // its west the way a box crossing the antimeridian is written, and it answers with nothing for a
    // pair MapLibre would throw on - a latitude past a pole, which a flat map's unproject can hand
    // back. boundsToBbox then brings both edges into range, so what comes out can be stated in a query.
    const area = readBounds([northWest.lng, southEast.lat, southEast.lng, northWest.lat]);
    if (!area) return console.warn('Could not read the area searched:', northWest, southEast);

    this.boundsChange.emit(boundsToBbox(area));
  }

  @Watch('records')
  @Watch('previewers')
  protected async onRecordsChange() {
    // Whatever the pointer was over is gone, and the place it named now names a different result. It
    // can't be re-asked either: MapLibre reports a pointer that moves, and this one is holding still.
    this.hovered = undefined;
    await this.load();
  }

  // The area being searched has changed. The box that says where it is changes with it, but nothing
  // about the results has moved, so nobody is asked for their extent a second time.
  @Watch('bounds')
  protected async onBoundsChange() {
    this.readSearchFilter();
    this.draw();
    await this.frame();
  }

  // A highlight arriving from outside. Only the marker and the box around its extent change - nothing
  // is taken off the map to do it, or the whole set of markers would blink each time the pointer moved
  // to the next row; see drawResults. The camera is left exactly where it is: something on the page has
  // said which result matters, not where to look, and flying the map at a row the reader happened to
  // hover is not what they asked for.
  @Watch('highlighted')
  protected onHighlightedChange() {
    this.draw();
  }

  // When the theme changes, swap the basemap to match, then draw the same results into the style
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

  // Everything, in the order it has to happen: what area is being searched, where the results are,
  // what goes on the map, and then where the camera looks.
  private async load() {
    this.readSearchFilter();
    await this.measure();
    this.draw();
    await this.frame();
  }

  // The area a search is filtered to, if this map can read what it was given. Read once per load
  // rather than at each of the two places that want it, so an unreadable one is reported once.
  private readSearchFilter() {
    this.searchFilter = this.bounds === undefined ? undefined : readBounds(this.bounds);
    if (this.bounds !== undefined && !this.searchFilter) console.warn('Could not read bounds:', this.bounds);
  }

  // Where every result is, and what each of them is called.
  //
  // Both are counted over, which is why both are kept: the extents are what get a number and a place
  // on the map, and the ids are what a highlight names when it names one by id rather than by place. A
  // record nobody could place holds its position in each, so the two stay in step with the list a
  // reader is reading beside the map.
  private async measure() {
    const previewers = this.previewers ?? locationsFor(this.records ?? []);

    // A hole keeps its place here as well, as the empty string, so the two lists stay the same length
    // and a highlight named by id lands on the right row. Nothing shows for the empty string itself:
    // it lands on the row of a result there was nothing to draw, which looks the same as asking for a
    // name nothing carries.
    this.ids = this.previewers ? this.previewers.map(previewer => previewer?.resourceId ?? '') : (this.records ?? []).map(record => record.id);

    // Asked of the previewers rather than read off the records, so an extent handed over and one
    // worked out here arrive by the same route - and so a geometry is squared off to its envelope in
    // one place. Nothing here reaches the network, since a LocationResource is built from a shape
    // rather than a URL, so all of them at once costs nothing.
    this.extents = await Promise.all(previewers.map(previewer => previewer?.getBounds()));
  }

  // Put the results on the map: their numbers, the highlighted one's own extent, and the area being
  // searched. See drawResults, which is where the order all of that goes on in lives.
  private draw() {
    if (!this.map || !this.mapStyleLoaded) return;

    // Only known now: the colors come out of the theme, and the theme can change under results that
    // are already on screen.
    drawResults(this.map, this.mapTheme.getStyle(), {
      extents: this.extents,
      highlighted: this.highlightedPositions(),
      searchBounds: this.searchFilter,
    });
  }

  // Point the camera at what should be in view: the area a search is filtered to, or the whole of
  // what is drawn.
  private async frame() {
    if (!this.map || !this.mapStyleLoaded) return;

    // Everywhere the results cover, or the whole world if none of them said where they are
    const target = this.searchFilter ?? unionBounds(this.extents) ?? WORLD;
    await frameLocation(this.map, this.mapTheme, target, this.projection === 'globe', this.camera());
  }

  // What the camera is allowed to do with what it was pointed at. The gap comes from frameLocation,
  // which both of these maps share; this is the part that differs.
  //
  // A zoom limit only for what was drawn, because there may be nothing named on the basemap to place
  // a page of results any closer by. An area a search is filtered to gets none: a reader who searched
  // a single street shouldn't come back to a view of the city.
  private camera(): maplibregl.FitBoundsOptions {
    return this.searchFilter ? {} : { maxZoom: LOCATION_MAX_ZOOM };
  }

  // Every result to draw as highlighted, counted from one: the one the page named and the one the
  // reader's pointer is over. Both, rather than one winning, because they are two separate statements
  // and neither is a correction of the other - though in practice they are the same result or there is
  // only one of them, since a pointer cannot be over a row beside the map and a number on it at once.
  private highlightedPositions(): number[] {
    const places = [this.highlightedPosition(), this.hovered].filter(place => place !== undefined);
    return [...new Set(places)];
  }

  /**
   * Which result the highlight names, counted from one.
   *
   * A number is a place in the list, and a string is an id - unless it is a place written down, which
   * is what an attribute hands over for either, since an attribute is always a string. An id is tried
   * first, because an id we hold is a match and a place is only a count: a page whose records are
   * named "1", "2", "3" means the record rather than the row.
   *
   * Counted over every result, including the ones nobody could place. The number is the row a reader
   * sees beside the map, so closing the gap a record with no bounding box leaves would point every
   * result after it at the wrong row - and a highlight that lands on one of those gaps draws nothing,
   * which is the truth. Nothing at all for a value naming neither an id nor a row, which is a map with
   * no highlight rather than one with the wrong highlight.
   */
  private highlightedPosition(): number | undefined {
    if (this.highlighted === undefined) return undefined;
    if (typeof this.highlighted === 'number') return this.position(this.highlighted);

    const named = this.ids.indexOf(this.highlighted);
    if (named >= 0) return named + 1;

    return this.position(Number(this.highlighted));
  }

  // A place in the list, if it is one at all. Bounded by what we hold, because a place past the end
  // names no result: Number('') is 0 and Number('somewhere') is NaN, and neither is a row.
  private position(place: number): number | undefined {
    return Number.isInteger(place) && place >= 1 && place <= this.extents.length ? place : undefined;
  }

  // Web Awesome is linked even though nothing here renders a wa-* element: MapLibreTheme reads
  // --wa-color-* tokens for the numbers and the boxes, and this component is meant to be used on
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
