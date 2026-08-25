import { describe, it, expect, h, vi, beforeEach, afterEach } from '@stencil/vitest';

// Rendered with Stencil's low-level render rather than @stencil/vitest's `render` wrapper, for the
// same reason ogm-map's tests are: the wrapper re-throws whatever a lifecycle method leaves behind.
// componentDidLoad never gets as far as a map here - happy-dom lays nothing out, so the container
// never has the box whenSized waits for. What's under test is what happens once a map exists, so one
// is handed to the component afterwards.
import { render as stencilRender } from '@stencil/core';
import { LngLat, Point } from 'maplibre-gl';

import { boundsToBbox } from '../../lib/geometry';
import { adoptWebAwesomeTheme } from '../../lib/init';
import LocationPreviewer from '../../lib/previewers/location';
import OgmRecord, { type GeoBlacklightSchemaAardvark } from '../../lib/record';
import LocationResource from '../../lib/resources/location';
import { HIGHLIGHT_BOUNDS, markerImageId, RESULT_MARKERS, RESULT_NUMBERS, SEARCH_BOUNDS } from '../../lib/results';
import MapLibreTheme, { darkBasemapStyle } from '../../lib/themes/maplibre';

// Enough of a MapLibre map to draw numbered results on, to be pointed at them, and to hang the
// controls off. MapLibre's own controls read a good deal of this as they are added - the titles to
// label themselves with, the zoom limits to grey their buttons at, the projection to show, the
// container to measure - because addControl below really runs onAdd.
class FakeMap {
  sources = new Map<string, any>();
  layers = new Map<string, any>();
  images = new Map<string, any>();
  fitBounds = vi.fn();
  setSky = vi.fn();
  setStyle = vi.fn();
  remove = vi.fn();
  keyboard = { disableRotation: vi.fn() };
  touchZoomRotate = { disableRotation: vi.fn() };
  controls: { control: any; position?: string; element: HTMLElement }[] = [];
  listeners: Record<string, ((event: unknown) => void)[]> = {};
  onceListeners: Record<string, ((event: unknown) => void)[]> = {};

  // Enough of the box-zoom handler to be switched on and off, and to have been caught mid-gesture
  boxZoom = { enable: vi.fn(), disable: vi.fn(), isEnabled: vi.fn(() => true), isActive: vi.fn(() => false), reset: vi.fn() };

  // Written and read back, rather than recorded: which projection the map is in is what decides
  // whether the camera clamps, and the globe button's own state is read straight off it
  projection: { type: string } | undefined = undefined;
  setProjection = vi.fn((spec: { type: string }) => (this.projection = spec));
  getProjection() {
    return this.projection;
  }

  // Pixels read as degrees, upside down. Which is all this needs: what matters is which corner of a
  // drag becomes which edge of the area reported, and the inversion is the part that matters, since
  // screen y grows downward and latitude grows upward.
  unproject([x, y]: [number, number]) {
    return new LngLat(x, -y);
  }

  // Resolving the corner the way Map.addControl does, so where a control lands can be asserted:
  // whatever it was given, else whatever the control asks for, else top right.
  addControl(control: any, position?: string) {
    this.controls.push({ control, position: position ?? control.getDefaultPosition?.() ?? 'top-right', element: control.onAdd(this) });
  }
  removeControl(control: any) {
    this.controls = this.controls.filter(added => added.control !== control);
    control.onRemove(this);
  }
  on(event: string, layer: unknown, listener?: (event: unknown) => void) {
    const [key, bound] = this.delegated(event, layer, listener);
    (this.listeners[key] ??= []).push(bound);
  }
  off(event: string, layer: unknown, listener?: (event: unknown) => void) {
    const [key, bound] = this.delegated(event, layer, listener);
    this.listeners[key] = (this.listeners[key] ?? []).filter(other => other !== bound);
  }
  // MapLibre takes a layer id in the middle when a listener is only interested in that layer's
  // features, so the two shapes are told apart the way it tells them apart
  private delegated(event: string, layer: unknown, listener?: (event: unknown) => void): [string, (event: unknown) => void] {
    return listener ? [`${event}:${layer}`, listener] : [event, layer as (event: unknown) => void];
  }
  fire(event: string, data: unknown = {}) {
    [...(this.listeners[event] ?? [])].forEach(listener => listener(data));
    [...(this.onceListeners[event] ?? []).splice(0)].forEach(listener => listener(data));
  }

  // 'moveend' is answered on the spot, because that is the one fitBounds waits on and there is no
  // camera here to finish moving. Everything else is held until a test fires it - which is what lets
  // the globe button's wait for a style document be asserted rather than assumed.
  once(event: string, listener: (event: unknown) => void) {
    if (event === 'moveend') return listener({});
    (this.onceListeners[event] ??= []).push(listener);
  }

  // A marker is a picture now, so the images are as much part of what gets drawn as the layers are
  addImage(id: string, image: any) {
    this.images.set(id, image);
  }
  removeImage(id: string) {
    this.images.delete(id);
  }
  hasImage(id: string) {
    return this.images.has(id);
  }
  listImages() {
    return [...this.images.keys()];
  }

  // Handed new data rather than taken off and put back, which is what a redraw does now; see drawResults
  getSource(id: string) {
    return this.sources.get(id);
  }
  addSource(id: string, spec: any) {
    this.sources.set(id, { ...spec, setData: (data: any) => (this.sources.get(id).data = data) });
  }
  removeSource(id: string) {
    this.sources.delete(id);
  }
  getLayer(id: string) {
    return this.layers.get(id);
  }
  addLayer(layer: any) {
    this.layers.set(layer.id, layer);
  }
  removeLayer(id: string) {
    this.layers.delete(id);
  }
  setPaintProperty(id: string, property: string, value: unknown) {
    this.layers.get(id).paint[property] = value;
  }
  cameraForBounds() {
    return { center: [0, 0], zoom: 4 };
  }
  // How much of a gap the camera can spare comes off the canvas; see fittablePadding
  getCanvas() {
    return { clientWidth: 800, clientHeight: 600 };
  }
  getCanvasContainer() {
    return document.createElement('div');
  }
  _getUIString(key: string) {
    return key;
  }
  getZoom() {
    return 4;
  }
  getMinZoom() {
    return 0;
  }
  getMaxZoom() {
    return 22;
  }
}

const record = (id: string, fields: Partial<GeoBlacklightSchemaAardvark> = {}) =>
  new OgmRecord({
    id,
    dct_title_s: id,
    gbl_resourceClass_sm: ['Datasets'],
    dct_accessRights_s: 'Public',
    gbl_mdVersion_s: 'Aardvark',
    ...fields,
  } as GeoBlacklightSchemaAardvark);

const CALIFORNIA = 'ENVELOPE(-124.41,-114.13,42.01,32.53)';
const ICELAND = 'ENVELOPE(-24.55,-13.49,66.57,63.39)';
const THE_WORLD = 'ENVELOPE(-180.0,180.0,85.0,-85.0)';

type Overview = HTMLElement & {
  records?: OgmRecord[];
  previewers?: (LocationPreviewer | undefined)[];
  theme: 'light' | 'dark';
  map: FakeMap;
  mapTheme: MapLibreTheme;
  mapStyleLoaded: boolean;
  projection: 'globe' | 'mercator';
  extents: unknown[];
  highlighted?: number | string;
  searchBounds?: number[] | string;
  viewBounds?: number[] | string;
  geosearch: boolean;
  searchHelpText: string;
  addControls: () => void;
  followPointer: () => void;
  handleStyleLoad: () => Promise<void>;
  handleProjectionTransition: () => Promise<void>;
  load: () => Promise<void>;
  draw: () => void;
  frame: () => Promise<void>;
  declaredExtents: () => unknown[];
  search: (start: Point, end: Point) => void;
  onRecordsChange: () => Promise<void>;
  onSearchBoundsChange: () => Promise<void>;
  onViewBoundsChange: () => Promise<void>;
  onHighlightedChange: () => void;
  onGeosearchChange: () => void;
  onSearchHelpTextChange: () => void;
  onThemeChange: () => Promise<void>;
  componentDidLoad: () => Promise<void>;
};

const containers: HTMLElement[] = [];
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  containers.splice(0).forEach(container => container.remove());
  consoleError.mockRestore();
});

// Mount the component, then hand it the map its own componentDidLoad couldn't build
const renderOverview = async () => {
  const container = document.createElement('div');
  containers.push(container);
  document.body.appendChild(container);
  await stencilRender(<ogm-overview></ogm-overview>, container);

  const el = container.firstElementChild as Overview & { componentOnReady?: () => Promise<unknown> };
  await el.componentOnReady?.();
  // Anything componentDidLoad reported on the way up is the WebGL gap, not what's under test
  consoleError.mockClear();

  const map = new FakeMap();
  Object.assign(el, { map, mapTheme: new MapLibreTheme(el, 'light'), mapStyleLoaded: true });
  return { el, map };
};

// One stylesheet's rules as text, which is how a sheet a component adopted can be compared with one
// this file built: the component came out of the built bundle, so its copy of the library is not the
// one this file's own imports name - see frameOf below for the same story told about a LngLatBounds.
const cssOf = (sheet: CSSStyleSheet): string =>
  Array.from(sheet.cssRules)
    .map(rule => rule.cssText)
    .join('\n');

// The Web Awesome theme as a component that took it should carry it
const webAwesomeTheme = (): string => {
  const root = document.createElement('div').attachShadow({ mode: 'open' });
  adoptWebAwesomeTheme(root.host);
  return cssOf(root.adoptedStyleSheets[0]);
};

const MARKER_LAYERS = [RESULT_MARKERS];
const BOX_LAYERS = (id: string) => [`${id}-fill`, `${id}-outline`];

// Every layer an overview draws, in the order they are drawn in. All of them go on with the first draw
// and none of them ever comes off: what a redraw changes is the data in them, which is what keeps a
// highlight from flashing. See drawResults.
const ALL_LAYERS = [...BOX_LAYERS(SEARCH_BOUNDS), ...BOX_LAYERS(HIGHLIGHT_BOUNDS), ...MARKER_LAYERS];

// Whether one of the two boxes has anything in it. Both stay on the map holding nothing when there is
// nothing to say, so being there is not the question.
const drawnBox = (map: FakeMap, id: string) => (map.sources.get(id)?.data.features ?? []).length > 0;

const layerIds = (map: FakeMap) => [...map.layers.keys()];
const marked = (map: FakeMap) => map.sources.get(RESULT_NUMBERS).data.features.map((feature: GeoJSON.Feature) => feature.properties);
// A pointer over some of the numbers, and a pointer leaving them, as MapLibre delegates each to a
// listener bound to that layer. The features arrive in no promised order, so a test can say so.
const pointAt = (map: FakeMap, ...labels: string[]) => map.fire(`mousemove:${RESULT_MARKERS}`, { features: labels.map(label => ({ properties: { label } })) });
const pointAway = (map: FakeMap) => map.fire(`mouseleave:${RESULT_MARKERS}`);

// Every number drawn as highlighted, and - where there should only be one - the one of them
const highlightedLabels = (map: FakeMap): string[] =>
  marked(map)
    .filter((properties: { highlighted: boolean }) => properties.highlighted)
    .map((properties: { label: string }) => properties.label);
const highlightedLabel = (map: FakeMap) => highlightedLabels(map)[0];

const framed = (map: FakeMap) => map.fitBounds.mock.calls.at(-1) as [maplibregl.LngLatBoundsLike, maplibregl.FitBoundsOptions];

// Where the camera was pointed, as west, south, east, north. Two shapes arrive: a camera held to what
// a globe can face is a LngLatBounds, and one that needed no holding is whatever it was given. Each
// is read as it is rather than put through LngLatBounds.convert, because the bounds a component built
// came out of the built bundle and so is not an instance of the class this file's own import names.
const frameOf = (map: FakeMap): [number, number, number, number] => {
  const [bounds] = framed(map);
  if (!Array.isArray(bounds)) return boundsToBbox(bounds as maplibregl.LngLatBounds);

  const [[west, south], [east, north]] = bounds as [[number, number], [number, number]];
  return [west, south, east, north];
};

// Long enough for a setTimeout(0) to have run, so a check deferred that way has had its turn
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('ogm-overview', () => {
  it('draws a numbered marker for every record it can place', async () => {
    const { el, map } = await renderOverview();
    el.records = [record('one', { dcat_bbox: CALIFORNIA }), record('two', { dcat_bbox: ICELAND })];
    await el.load();

    expect(marked(map).map((properties: { label: string }) => properties.label)).toEqual(['1', '2']);
    expect(layerIds(map)).toEqual(ALL_LAYERS);
  });

  // A page of boxes says less than a page of numbers a reader can find again in the list beside the
  // map. The two boxes that are drawn are the ones that answer a question; see below.
  it('draws nothing of a result but its number', async () => {
    const { el, map } = await renderOverview();
    el.records = [record('one', { dcat_bbox: CALIFORNIA })];
    await el.load();

    expect(drawnBox(map, SEARCH_BOUNDS)).toBe(false);
    expect(drawnBox(map, HIGHLIGHT_BOUNDS)).toBe(false);
  });

  // Which is what `locationsFor` hands back, and what the library documents as the way to build these
  // by hand: a record it could not place is a gap rather than a missing entry
  it('numbers a list of extents with gaps in it', async () => {
    const { el, map } = await renderOverview();
    el.previewers = [
      new LocationPreviewer(new LocationResource('one', { type: 'Point', coordinates: [0, 0] })),
      undefined,
      new LocationPreviewer(new LocationResource('three', { type: 'Point', coordinates: [10, 10] })),
    ];
    await el.load();

    expect(marked(map).map((properties: { label: string }) => properties.label)).toEqual(['1', '3']);
  });

  it('highlights one of those by id, counting the gap', async () => {
    const { el, map } = await renderOverview();
    el.previewers = [
      new LocationPreviewer(new LocationResource('one', { type: 'Point', coordinates: [0, 0] })),
      undefined,
      new LocationPreviewer(new LocationResource('three', { type: 'Point', coordinates: [10, 10] })),
    ];
    await el.load();

    el.highlighted = 'three';
    el.onHighlightedChange();

    expect(highlightedLabel(map)).toEqual('3');
  });

  it('numbers the extents it was handed instead of the records’ own', async () => {
    const { el, map } = await renderOverview();
    el.records = [record('one', { dcat_bbox: CALIFORNIA })];
    el.previewers = [new LocationPreviewer(new LocationResource('handed-over', { type: 'Point', coordinates: [0, 0] }))];
    await el.load();

    expect(map.sources.get(RESULT_NUMBERS).data.features).toHaveLength(1);
    expect(map.sources.get(RESULT_NUMBERS).data.features[0].geometry.coordinates).toEqual([0, 0]);
  });

  // The number is the row a reader sees beside the map, so closing the gap would point every result
  // after it at the wrong row
  it('spends a number on a record it has nowhere to put', async () => {
    const { el, map } = await renderOverview();
    el.records = [record('one', { dcat_bbox: CALIFORNIA }), record('nowhere'), record('three', { dcat_bbox: ICELAND })];
    await el.load();

    expect(marked(map).map((properties: { label: string }) => properties.label)).toEqual(['1', '3']);
  });

  it('replaces the last set of numbers rather than adding to it', async () => {
    const { el, map } = await renderOverview();
    el.records = [record('one', { dcat_bbox: CALIFORNIA }), record('two', { dcat_bbox: ICELAND })];
    await el.load();

    el.records = [record('three', { dcat_bbox: ICELAND })];
    await el.onRecordsChange();

    expect(marked(map).map((properties: { label: string }) => properties.label)).toEqual(['1']);
    // The same layers throughout, in the same order: what a redraw changes is the data in them
    expect(layerIds(map)).toEqual(ALL_LAYERS);
  });

  it('shows the whole world when it has no records to place', async () => {
    const { el, map } = await renderOverview();
    el.records = [];
    await el.load();

    // Held to the half of the world a globe camera can face; see frameLocation
    expect(frameOf(map)).toEqual([-90, -85, 90, 85]);
  });

  it('opens on a globe, whatever it has to show', async () => {
    const { el, map } = await renderOverview();
    el.records = [record('one', { dcat_bbox: CALIFORNIA }), record('two', { dcat_bbox: ICELAND })];
    el.mapStyleLoaded = false;
    await el.handleStyleLoad();

    expect(map.setProjection).toHaveBeenCalledWith({ type: 'globe' });
    // The order matters: whether the camera clamps is read off the projection it is pointed in
    expect(map.setProjection.mock.invocationCallOrder[0]).toBeLessThan(map.fitBounds.mock.invocationCallOrder[0]);
    expect(map.setSky).toHaveBeenCalled();
  });

  // A style loading is itself a projection change: it ends by setting whatever it names, and neither
  // basemap names anything, so every style document arrives flat. Read as the reader's own choice,
  // that flattened a globe on every theme swap.
  it('keeps the globe a style document resets on its way in', async () => {
    const { el, map } = await renderOverview();
    el.mapStyleLoaded = false;

    map.projection = { type: 'mercator' };
    await el.handleProjectionTransition();

    expect(map.fitBounds).not.toHaveBeenCalled();

    await el.handleStyleLoad();

    expect(map.setProjection).toHaveBeenCalledWith({ type: 'globe' });
  });

  // The sequence a page that sets the theme as its maps are being built produces, which is what
  // GeoBlacklight's own theme initializer does: the swap is asked for while the first style document
  // is still on its way, so that document still lands and raises the flag, and the reset the second
  // one arrives with falls after it. Taken for the reader reaching for the globe button, that left
  // the map flat and kept it flat, because the choice was then remembered and put back.
  it('keeps the globe through a swap asked for before its first style had loaded', async () => {
    const { el, map } = await renderOverview();
    el.records = [record('one', { dcat_bbox: CALIFORNIA })];
    el.mapStyleLoaded = false;

    el.theme = 'dark';
    const swapped = el.onThemeChange();
    map.fire('style.load');
    await swapped;

    // The first document landing, which puts the globe into it and raises the flag
    await el.handleStyleLoad();

    expect(map.setProjection).toHaveBeenLastCalledWith({ type: 'globe' });

    // And then the document the swap asked for, arriving in the projection it names
    map.projection = { type: 'mercator' };
    await el.handleProjectionTransition();
    await el.handleStyleLoad();

    expect(map.setProjection).toHaveBeenLastCalledWith({ type: 'globe' });
  });

  it('opens in the projection the reader last chose, after a change of theme', async () => {
    const { el, map } = await renderOverview();
    el.projection = 'mercator';
    el.mapStyleLoaded = false;
    await el.handleStyleLoad();

    expect(map.setProjection).toHaveBeenCalledWith({ type: 'mercator' });
  });

  // A globe camera has no answer for anything wider than the half of the world facing it: it hands
  // back nothing and leaves the camera where it was, rather than saying so
  it('holds a globe camera to the half of the world it can point at', async () => {
    const { el, map } = await renderOverview();
    el.records = [record('the-world', { dcat_bbox: THE_WORLD })];
    await el.load();

    expect(frameOf(map)).toEqual([-90, -85, 90, 85]);
  });

  it('points a flat map at the whole of what it drew', async () => {
    const { el, map } = await renderOverview();
    el.projection = 'mercator';
    el.records = [record('the-world', { dcat_bbox: THE_WORLD })];
    await el.load();

    expect(frameOf(map)).toEqual([-180, -85, 180, 85]);
  });

  // Which is what the globe button is for: the whole of a set of results too wide to fit on a sphere
  // is only visible on a flat map
  it('frames what it drew again when the reader changes projection', async () => {
    const { el, map } = await renderOverview();
    el.records = [record('the-world', { dcat_bbox: THE_WORLD })];
    await el.load();
    const framedOnce = map.fitBounds.mock.calls.length;

    // The map is already flat by the time it says so: MapLibre changes the projection and announces
    // the change afterwards, and what the camera does is read off the map rather than off the news
    map.projection = { type: 'mercator' };
    await el.handleProjectionTransition();

    expect(map.fitBounds.mock.calls.length).toBeGreaterThan(framedOnce);
    expect(frameOf(map)).toEqual([-180, -85, 180, 85]);
  });

  // What the map is built already pointed at, before a single previewer has been asked anything: see
  // MapPreviewer.declaredBounds. They have to be the extents measure() goes on to settle on, or
  // opening there would move the reader twice instead of saving them the trip in from the world.
  it('opens on the extents it goes on to frame', async () => {
    const { el } = await renderOverview();
    el.records = [record('one', { dcat_bbox: CALIFORNIA }), record('nowhere'), record('two', { locn_geometry: 'POINT(-122.17 37.43)' })];

    const opening = el.declaredExtents();
    await el.load();

    expect(opening).toEqual(el.extents);
  });

  // There may be nothing named on the basemap to place a page of results any closer by
  it('opens no closer than city scale, whatever it was asked to frame', async () => {
    const { el, map } = await renderOverview();
    el.records = [record('a-point', { locn_geometry: 'POINT(-122.17 37.43)' })];
    await el.load();

    expect(framed(map)[1].maxZoom).toEqual(12);
  });

  // The gap the theme keeps around an overview, which is wider than the one a preview gets: a marker
  // drawn against the edge of a map this small reads as running off it.
  it('holds what it frames away from the edge of the map', async () => {
    const { el, map } = await renderOverview();
    el.records = [record('one', { dcat_bbox: CALIFORNIA })];
    await el.load();

    const [, options] = framed(map);
    expect(options.padding).toEqual(el.mapTheme.getOverviewPadding());
    expect(options.padding).toBeGreaterThan(el.mapTheme.getPadding());
  });

  it('carries the Web Awesome scope, being usable on its own', async () => {
    const { el } = await renderOverview();

    expect(el.className).toContain('wa-palette-default');
    expect((el.shadowRoot as ShadowRoot).adoptedStyleSheets.map(cssOf)).toContain(webAwesomeTheme());
  });

  it('takes its map down with it once it is sure the disconnect is not a relocation', async () => {
    const { el, map } = await renderOverview();
    el.remove();

    expect(map.remove).not.toHaveBeenCalled();
    await flush();

    expect(map.remove).toHaveBeenCalled();
  });

  // What a page preserving this element across a Turbo visit does: detach it from the old document,
  // then reattach it to the new one, before anything else gets a turn to run. appendChild on an
  // already-connected element does exactly that in one step - disconnect, then reconnect - which is
  // what fires disconnectedCallback here rather than a direct call to it. A map that survives keeps
  // its canvas, its loaded tiles, everything a rebuild would have thrown away and fetched again.
  it('keeps its map when a disconnect is followed by a reconnect, rather than tearing it down', async () => {
    const { el, map } = await renderOverview();
    document.body.appendChild(el);

    await flush();

    expect(map.remove).not.toHaveBeenCalled();
  });
});

describe('ogm-overview search filter', () => {
  it('points the camera where it was told, rather than at what it drew', async () => {
    const { el, map } = await renderOverview();
    el.records = [record('one', { dcat_bbox: ICELAND })];
    await el.load();

    el.searchBounds = CALIFORNIA;
    await el.onSearchBoundsChange();

    expect(frameOf(map)).toEqual([-124.41, 32.53, -114.13, 42.01]);
    // Only the view of it changed; the results are still on the map, still numbered
    expect(marked(map).map((properties: { label: string }) => properties.label)).toEqual(['1']);
  });

  it('draws the area being searched as a box under everything else', async () => {
    const { el, map } = await renderOverview();
    el.records = [record('one', { dcat_bbox: ICELAND })];
    el.searchBounds = CALIFORNIA;
    await el.load();

    expect(layerIds(map)).toEqual(ALL_LAYERS);
    expect(map.sources.get(SEARCH_BOUNDS).data.features[0].geometry.coordinates[0][0]).toEqual([-124.41, 32.53]);
  });

  it('takes the box away when the search filter is withdrawn', async () => {
    const { el, map } = await renderOverview();
    el.searchBounds = CALIFORNIA;
    await el.load();

    el.searchBounds = undefined;
    await el.onSearchBoundsChange();

    expect(drawnBox(map, SEARCH_BOUNDS)).toBe(false);
  });

  // The same gap everything else gets, which is what makes the box readable as a box - and a reader
  // who searched one street shouldn't come back to a view of the city, so no zoom limit
  it('gives a search filter the same room it gives everything else', async () => {
    const { el, map } = await renderOverview();
    el.searchBounds = CALIFORNIA;
    await el.load();

    const [, options] = framed(map);
    expect(options.padding).toEqual(el.mapTheme.getOverviewPadding());
    expect(options.maxZoom).toBeUndefined();
  });

  it('returns to the search filter when what is drawn changes', async () => {
    const { el, map } = await renderOverview();
    el.searchBounds = CALIFORNIA;
    el.records = [record('one', { dcat_bbox: ICELAND })];
    await el.load();

    el.records = [record('two', { dcat_bbox: THE_WORLD })];
    await el.onRecordsChange();

    expect(frameOf(map)).toEqual([-124.41, 32.53, -114.13, 42.01]);
  });

  it('goes back to framing what it drew when the filter is withdrawn', async () => {
    const { el, map } = await renderOverview();
    el.records = [record('one', { dcat_bbox: ICELAND })];
    el.searchBounds = CALIFORNIA;
    await el.load();

    el.searchBounds = undefined;
    await el.onSearchBoundsChange();

    expect(frameOf(map)).toEqual([-24.55, 63.39, -13.49, 66.57]);
    expect(framed(map)[1].maxZoom).toEqual(12);
  });

  // Which is how a page rendered by a server says what its map is filtered to, without any JavaScript
  it('takes a filter from an attribute', async () => {
    const { el, map } = await renderOverview();
    el.setAttribute('search-bounds', CALIFORNIA);

    expect(el.searchBounds).toEqual(CALIFORNIA);
    await el.onSearchBoundsChange();

    expect(frameOf(map)).toEqual([-124.41, 32.53, -114.13, 42.01]);
    expect(drawnBox(map, SEARCH_BOUNDS)).toBe(true);
  });

  it('frames what it drew, and says so, when it cannot read the filter it was given', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { el, map } = await renderOverview();
    el.records = [record('one', { dcat_bbox: ICELAND })];
    el.searchBounds = 'somewhere nice';
    // Whatever the watcher said about it on the way in; what is under test is the load below
    consoleWarn.mockClear();
    await el.load();

    expect(consoleWarn).toHaveBeenCalledWith('Could not read searchBounds:', 'somewhere nice');
    // Once per load, rather than once for the box and again for the camera
    expect(consoleWarn).toHaveBeenCalledTimes(1);
    expect(frameOf(map)).toEqual([-24.55, 63.39, -13.49, 66.57]);
    consoleWarn.mockRestore();
  });
});

describe('ogm-overview default view', () => {
  it('points the camera there when there is nothing else to look at', async () => {
    const { el, map } = await renderOverview();
    el.viewBounds = CALIFORNIA;
    await el.load();

    expect(frameOf(map)).toEqual([-124.41, 32.53, -114.13, 42.01]);
  });

  // The whole point of it: a page states where the map should open, not what it should say is there
  it('draws nothing for it', async () => {
    const { el, map } = await renderOverview();
    el.viewBounds = CALIFORNIA;
    await el.load();

    expect(drawnBox(map, SEARCH_BOUNDS)).toBe(false);
    expect(layerIds(map)).toEqual(ALL_LAYERS);
  });

  // An active filter is a stronger statement than a default opening point - though in practice a
  // page never states both at once
  it('loses to a search filter when both are given', async () => {
    const { el, map } = await renderOverview();
    el.searchBounds = ICELAND;
    el.viewBounds = CALIFORNIA;
    await el.load();

    expect(frameOf(map)).toEqual([-24.55, 63.39, -13.49, 66.57]);
  });

  it('loses to what it drew when both are given', async () => {
    const { el, map } = await renderOverview();
    el.records = [record('one', { dcat_bbox: ICELAND })];
    el.viewBounds = CALIFORNIA;
    await el.load();

    expect(frameOf(map)).toEqual([-24.55, 63.39, -13.49, 66.57]);
  });

  // Unlike everything else this frames: a page that set this has already chosen the exact box the
  // map should show, so nothing here pads it or holds it back from zooming in past city scale
  it('is framed exactly, with no gap and no ceiling on how far in it can zoom', async () => {
    const { el, map } = await renderOverview();
    el.viewBounds = CALIFORNIA;
    await el.load();

    const [, options] = framed(map);
    expect(options.padding).toEqual(0);
    expect(options.maxZoom).toBeUndefined();
  });

  it('moves the camera when it changes', async () => {
    const { el, map } = await renderOverview();
    await el.load();

    el.viewBounds = CALIFORNIA;
    await el.onViewBoundsChange();

    expect(frameOf(map)).toEqual([-124.41, 32.53, -114.13, 42.01]);
  });

  it('goes back to the whole world when it is withdrawn and there is nothing else to show', async () => {
    const { el, map } = await renderOverview();
    el.viewBounds = CALIFORNIA;
    await el.load();

    el.viewBounds = undefined;
    await el.onViewBoundsChange();

    expect(frameOf(map)).toEqual([-90, -85, 90, 85]);
  });

  // Which is how a page rendered by a server says where its map should default to, without any
  // JavaScript at all
  it('is read from an attribute', async () => {
    const { el, map } = await renderOverview();
    el.setAttribute('view-bounds', CALIFORNIA);

    expect(el.viewBounds).toEqual(CALIFORNIA);
    await el.onViewBoundsChange();

    expect(frameOf(map)).toEqual([-124.41, 32.53, -114.13, 42.01]);
  });

  it('says so, and opens on the whole world, when it cannot read the default it was given', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { el, map } = await renderOverview();
    el.viewBounds = 'somewhere nice';
    consoleWarn.mockClear();
    await el.load();

    expect(consoleWarn).toHaveBeenCalledWith('Could not read viewBounds:', 'somewhere nice');
    expect(consoleWarn).toHaveBeenCalledTimes(1);
    expect(frameOf(map)).toEqual([-90, -85, 90, 85]);
    consoleWarn.mockRestore();
  });
});

describe('ogm-overview highlight', () => {
  const two = async () => {
    const rendered = await renderOverview();
    rendered.el.records = [record('one', { dcat_bbox: CALIFORNIA }), record('two', { dcat_bbox: ICELAND })];
    await rendered.el.load();
    return rendered;
  };

  // The colors of a hovered feature, since being pointed at is what is being said - by a page here,
  // and by the reader's own pointer in the tests below
  it('brings the result it was pointed at to the front, in the colors of a highlight', async () => {
    const { el, map } = await two();
    el.highlighted = 2;
    el.onHighlightedChange();

    expect(highlightedLabel(map)).toEqual('2');
    // It wears a picture of its own, which is what carries the color, and sorts above every other
    const style = el.mapTheme.getStyle();
    expect(marked(map).map((properties: { icon: string }) => properties.icon)).toEqual([markerImageId('1', style), markerImageId('2', style, true)]);
    expect(map.layers.get(RESULT_MARKERS).layout['symbol-sort-key']).toEqual(['case', ['get', 'highlighted'], 1, ['-', 0, ['to-number', ['get', 'label']]]]);
  });

  it('draws the highlighted result’s own extent under its number', async () => {
    const { el, map } = await two();
    el.highlighted = 2;
    el.onHighlightedChange();

    expect(map.sources.get(HIGHLIGHT_BOUNDS).data.features[0].geometry.coordinates[0][0]).toEqual([-24.55, 63.39]);
    expect(layerIds(map)).toEqual(ALL_LAYERS);
    expect(map.layers.get(`${HIGHLIGHT_BOUNDS}-outline`).paint['line-color']).toEqual(el.mapTheme.getStyle().strokeHighlightColor);
  });

  it('highlights a result named by id', async () => {
    const { el, map } = await two();
    el.highlighted = 'two';
    el.onHighlightedChange();

    expect(highlightedLabel(map)).toEqual('2');
  });

  // An attribute is always a string, and Stencil hands one over as it stands for a prop that takes
  // either a number or a string
  it('highlights a place written down, which is what an attribute hands over', async () => {
    const { el, map } = await two();
    el.setAttribute('highlighted', '2');

    expect(el.highlighted).toEqual('2');
    el.onHighlightedChange();

    expect(highlightedLabel(map)).toEqual('2');
  });

  // An id we hold is a match; a place is only a count
  it('prefers a result whose id is a number to the row of that number', async () => {
    const { el, map } = await renderOverview();
    el.records = [record('3', { dcat_bbox: CALIFORNIA }), record('1', { dcat_bbox: ICELAND })];
    await el.load();

    el.highlighted = '1';
    el.onHighlightedChange();

    expect(highlightedLabel(map)).toEqual('2');
  });

  it('highlights a previewer by the id of the resource it draws', async () => {
    const { el, map } = await renderOverview();
    el.previewers = [new LocationPreviewer(new LocationResource('handed-over', { type: 'Point', coordinates: [0, 0] }))];
    await el.load();

    el.highlighted = 'handed-over';
    el.onHighlightedChange();

    expect(highlightedLabel(map)).toEqual('1');
  });

  // There is no number on the map to bring forward and no extent to draw around, which is the truth
  it('highlights nothing for a result it has nowhere to put', async () => {
    const { el, map } = await renderOverview();
    el.records = [record('one', { dcat_bbox: CALIFORNIA }), record('nowhere')];
    await el.load();

    el.highlighted = 2;
    el.onHighlightedChange();

    expect(highlightedLabel(map)).toBeUndefined();
    expect(drawnBox(map, HIGHLIGHT_BOUNDS)).toBe(false);
  });

  // A map with no highlight, rather than one with the wrong highlight. Each of these is a value a page
  // can plausibly arrive at - a name nothing carries, a row past the end, a row counted from zero, a
  // number that is no row at all - and none of them may land on a neighbour.
  it('highlights nothing it cannot find', async () => {
    const { el, map } = await two();

    for (const value of ['nope', 99, 0, -1, '', 1.5]) {
      el.highlighted = value as number | string;
      el.onHighlightedChange();

      expect(highlightedLabel(map)).toBeUndefined();
      expect(drawnBox(map, HIGHLIGHT_BOUNDS)).toBe(false);
    }
  });

  // The one it could land on by accident: the row before the end, if a place past the end were let
  // through and read modulo the list, or if a fractional place were rounded
  it('does not round a place onto the row beside it', async () => {
    const { el, map } = await two();

    el.highlighted = 1.6;
    el.onHighlightedChange();

    expect(highlightedLabel(map)).toBeUndefined();
  });

  it('clears the highlight when it is withdrawn', async () => {
    const { el, map } = await two();
    el.highlighted = 1;
    el.onHighlightedChange();

    el.highlighted = undefined;
    el.onHighlightedChange();

    expect(highlightedLabel(map)).toBeUndefined();
    expect(drawnBox(map, HIGHLIGHT_BOUNDS)).toBe(false);
  });

  // The redraw a hover drives, over and over as the pointer moves down the list beside the map. Nothing
  // comes off the map to do it: dropping a source drops its tiles on the spot, and taking a marker's
  // picture off has MapLibre place every symbol on the map again, so either one costs a frame with no
  // numbers in it - which is what a reader sees as a flash. See drawResults.
  it('takes nothing off the map to move the highlight', async () => {
    const { el, map } = await two();
    const removeLayer = vi.spyOn(map, 'removeLayer');
    const removeSource = vi.spyOn(map, 'removeSource');
    const removeImage = vi.spyOn(map, 'removeImage');
    const drawn = layerIds(map);

    for (const value of [1, 2, undefined]) {
      el.highlighted = value;
      el.onHighlightedChange();
    }

    expect(layerIds(map)).toEqual(drawn);
    expect(removeLayer).not.toHaveBeenCalled();
    expect(removeSource).not.toHaveBeenCalled();
    expect(removeImage).not.toHaveBeenCalled();
  });

  // Something on the page has said which result matters, not where to look
  it('leaves the camera where it is when the highlight changes', async () => {
    const { el, map } = await two();
    const framedOnce = map.fitBounds.mock.calls.length;

    el.highlighted = 2;
    el.onHighlightedChange();

    expect(map.fitBounds.mock.calls.length).toEqual(framedOnce);
    expect(drawnBox(map, HIGHLIGHT_BOUNDS)).toBe(true);
  });
});

describe('ogm-overview pointer', () => {
  // The pointer is bound to the layer in componentDidLoad, which never gets as far as a map here; see
  // renderOverview. Everything else about these is what the reader does.
  const hovering = async () => {
    const rendered = await renderOverview();
    rendered.el.records = [record('one', { dcat_bbox: CALIFORNIA }), record('two', { dcat_bbox: ICELAND })];
    await rendered.el.load();
    rendered.el.followPointer();

    // What a page would be listening for, in the order it arrives
    const reported: unknown[] = [];
    rendered.el.addEventListener('highlightChange', event => reported.push((event as CustomEvent).detail));

    return { ...rendered, reported };
  };

  // The reader's own way of asking the same question the `highlighted` prop asks
  it('highlights the number the pointer is over, and draws its extent', async () => {
    const { map } = await hovering();
    pointAt(map, '2');

    expect(highlightedLabels(map)).toEqual(['2']);
    expect(map.sources.get(HIGHLIGHT_BOUNDS).data.features[0].geometry.coordinates[0][0]).toEqual([-24.55, 63.39]);
  });

  it('lets the highlight go when the pointer leaves', async () => {
    const { map } = await hovering();
    pointAt(map, '2');
    pointAway(map);

    expect(highlightedLabels(map)).toEqual([]);
    expect(drawnBox(map, HIGHLIGHT_BOUNDS)).toBe(false);
  });

  // Markers overlap, and the one the reader can see is the earliest of them, since that is how they are
  // sorted. MapLibre hands back everything under the pointer without promising an order.
  it('highlights the number drawn on top where two of them overlap', async () => {
    const { map } = await hovering();
    pointAt(map, '2', '1');

    expect(highlightedLabels(map)).toEqual(['1']);
  });

  // Two separate statements about two different rows, and neither is a correction of the other
  it('highlights what the page named and what the pointer is over', async () => {
    const { el, map } = await hovering();
    el.highlighted = 1;
    el.onHighlightedChange();
    pointAt(map, '2');

    expect(highlightedLabels(map)).toEqual(['1', '2']);
    expect(map.sources.get(HIGHLIGHT_BOUNDS).data.features).toHaveLength(2);
  });

  // The pointer reports every pixel it crosses, and a marker is a good many pixels wide
  it('redraws nothing while the pointer stays on the same number', async () => {
    const { map } = await hovering();
    pointAt(map, '2');
    const setData = vi.spyOn(map.sources.get(RESULT_NUMBERS), 'setData');

    pointAt(map, '2');
    pointAt(map, '2');

    expect(setData).not.toHaveBeenCalled();
  });

  // Something on the page has said which result matters, not where to look - and a pointer resting on a
  // number has said even less than that
  it('leaves the camera where it is when the pointer moves', async () => {
    const { map } = await hovering();
    const framed = map.fitBounds.mock.calls.length;

    pointAt(map, '2');

    expect(map.fitBounds.mock.calls.length).toEqual(framed);
  });

  // The place the pointer named now names a different result, and MapLibre won't say so again: it
  // reports a pointer that moves, and this one is holding still.
  it('forgets what the pointer was over when the results change', async () => {
    const { el, map } = await hovering();
    pointAt(map, '2');

    el.records = [record('three', { dcat_bbox: ICELAND })];
    await el.onRecordsChange();

    expect(highlightedLabels(map)).toEqual([]);
  });

  // What a list beside the map needs to light up the row the reader is pointing at. Both terms, since a
  // page holds its results in one or the other.
  it('says which result the pointer is over, by place and by id', async () => {
    const { map, reported } = await hovering();
    pointAt(map, '2');

    expect(reported).toEqual([{ place: 2, id: 'two' }]);
  });

  // The id of the resource a previewer draws, which is what that path has instead of a record
  it('names the resource a previewer draws when that is what it was given', async () => {
    const { el, map, reported } = await renderOverview().then(async rendered => {
      rendered.el.previewers = [new LocationPreviewer(new LocationResource('a-resource', { type: 'Point', coordinates: [0, 0] }))];
      await rendered.el.load();
      rendered.el.followPointer();
      const reported: unknown[] = [];
      rendered.el.addEventListener('highlightChange', event => reported.push((event as CustomEvent).detail));
      return { ...rendered, reported };
    });
    pointAt(map, '1');

    expect(el.previewers).toHaveLength(1);
    expect(reported).toEqual([{ place: 1, id: 'a-resource' }]);
  });

  // Null rather than undefined, because that is what a CustomEvent carries either way
  it('says so when the pointer leaves', async () => {
    const { map, reported } = await hovering();
    pointAt(map, '2');
    pointAway(map);

    expect(reported).toEqual([{ place: 2, id: 'two' }, null]);
  });

  it('says nothing twice while the pointer stays on the same number', async () => {
    const { map, reported } = await hovering();
    pointAt(map, '1');
    pointAt(map, '1');
    pointAt(map, '2');

    expect(reported).toEqual([
      { place: 1, id: 'one' },
      { place: 2, id: 'two' },
    ]);
  });

  // A page that has said which result matters already knows. Reporting it back is a loop waiting to be
  // wired, since the obvious handler for this event is the one that sets the prop.
  it('says nothing when the highlight is set from outside', async () => {
    const { el, reported } = await hovering();
    el.highlighted = 2;
    el.onHighlightedChange();

    el.highlighted = undefined;
    el.onHighlightedChange();

    expect(reported).toEqual([]);
  });

  // Or the row stays lit beside a map that no longer has that marker on it
  it('says the pointer is over nothing when the results change under it', async () => {
    const { el, map, reported } = await hovering();
    pointAt(map, '2');

    el.records = [record('three', { dcat_bbox: ICELAND })];
    await el.onRecordsChange();

    expect(reported).toEqual([{ place: 2, id: 'two' }, null]);
  });

  // A style document is emptied and rebuilt by a theme swap, but a layer listener is the map's own
  it('goes on following the pointer after a theme swap', async () => {
    const { el, map } = await hovering();

    el.theme = 'dark';
    const swapped = el.onThemeChange();
    map.fire('style.load');
    await swapped;
    await el.handleStyleLoad();
    pointAt(map, '2');

    expect(highlightedLabels(map)).toEqual(['2']);
  });
});

describe('ogm-overview controls', () => {
  // The no-pitch test as much as the zoom one: with no compass there is no control that can turn or
  // tilt the map, which is what the compass button and its pitch visualiser are for
  it('offers zoom buttons and no compass', async () => {
    const { el, map } = await renderOverview();
    el.addControls();

    const { element } = map.controls[0];
    expect(Array.from(element.querySelectorAll('button'), button => button.className)).toEqual(['maplibregl-ctrl-zoom-in', 'maplibregl-ctrl-zoom-out']);
    expect(element.querySelector('.maplibregl-ctrl-compass')).toBeNull();
  });

  it('offers a projection toggle, so an overview can be flattened', async () => {
    const { el, map } = await renderOverview();
    el.addControls();
    map.fire('style.load');

    expect(map.controls.some(added => added.element.querySelector('[class^="maplibregl-ctrl-globe"]'))).toBe(true);
  });
});

describe('ogm-overview geosearch', () => {
  it('offers no search unless it was asked to', async () => {
    const { el, map } = await renderOverview();
    el.onGeosearchChange();

    expect(map.controls).toEqual([]);
    expect(map.boxZoom.disable).toHaveBeenCalled();
  });

  // Top left because the zoom and globe buttons are top right, and the attribution both basemaps
  // require is bottom right
  it('puts the help text over the top left of the map', async () => {
    const { el, map } = await renderOverview();
    el.geosearch = true;
    el.onGeosearchChange();

    expect(map.controls).toHaveLength(1);
    expect(map.controls[0].position).toEqual('top-left');
    expect(map.controls[0].element.className).toContain('maplibregl-ctrl-geosearch');
    expect(map.controls[0].element.textContent).toEqual(el.searchHelpText);
  });

  it('hands the control its wording, and passes on a change to it', async () => {
    const { el, map } = await renderOverview();
    el.geosearch = true;
    el.searchHelpText = 'Cerca arrossegant amb la tecla de majúscules';
    el.onGeosearchChange();

    const { element } = map.controls[0];
    expect(element.textContent).toEqual('Cerca arrossegant amb la tecla de majúscules');

    el.searchHelpText = 'Shift + drag to search an area';
    el.onSearchHelpTextChange();
    expect(element.textContent).toEqual('Shift + drag to search an area');
  });

  it('answers shift+drag only when it was asked to', async () => {
    const { el, map } = await renderOverview();
    el.geosearch = true;
    el.onGeosearchChange();

    expect(map.boxZoom.enable).toHaveBeenCalled();
    expect(map.boxZoom.disable).not.toHaveBeenCalled();

    map.boxZoom.enable.mockClear();
    el.geosearch = false;
    el.onGeosearchChange();

    expect(map.boxZoom.disable).toHaveBeenCalled();
    expect(map.boxZoom.enable).not.toHaveBeenCalled();
  });

  // A disabled handler stops being offered the mouseup that would have cleared its rectangle and the
  // crosshair cursor, so a gesture caught halfway has to be called off first
  it('clears a gesture it was switched off partway through', async () => {
    const { el, map } = await renderOverview();
    el.geosearch = true;
    el.onGeosearchChange();

    map.boxZoom.isActive.mockReturnValue(true);
    el.geosearch = false;
    el.onGeosearchChange();

    expect(map.boxZoom.reset).toHaveBeenCalled();
    expect(map.boxZoom.reset.mock.invocationCallOrder[0]).toBeLessThan(map.boxZoom.disable.mock.invocationCallOrder.at(-1)!);
  });

  it('takes the control back off, and its bindings with it, when the offer is withdrawn', async () => {
    const { el, map } = await renderOverview();
    el.geosearch = true;
    el.onGeosearchChange();

    el.geosearch = false;
    el.onGeosearchChange();

    expect(map.controls).toEqual([]);
    expect(map.listeners['boxzoomstart']).toEqual([]);
  });

  it('gets out of the way while a box is being drawn', async () => {
    const { el, map } = await renderOverview();
    el.geosearch = true;
    el.onGeosearchChange();
    const { element } = map.controls[0];

    map.fire('boxzoomstart');
    expect(element.hidden).toBe(true);

    map.fire('boxzoomend');
    expect(element.hidden).toBe(false);
  });

  // The whole point of the gesture: what comes out is the box the reader drew, as an area a query can
  // state. The fake reads pixels as degrees upside down, so the top of the box is its north edge.
  it('reports the area the reader drew, in west, south, east, north', async () => {
    const { el } = await renderOverview();
    const areas: [number, number, number, number][] = [];
    el.addEventListener('boundsChange', event => areas.push((event as CustomEvent<[number, number, number, number]>).detail));

    el.search(new Point(10, 10), new Point(30, 40));

    expect(areas).toEqual([[10, -40, 30, -10]]);
  });

  it('reports the same area whichever way the reader dragged it', async () => {
    const { el } = await renderOverview();
    const areas: [number, number, number, number][] = [];
    el.addEventListener('boundsChange', event => areas.push((event as CustomEvent<[number, number, number, number]>).detail));

    el.search(new Point(30, 40), new Point(10, 10));

    expect(areas).toEqual([[10, -40, 30, -10]]);
  });

  // Which edge is west is decided on screen rather than by longitude: taking the smaller of 175 and
  // -175 for west would describe the other 350 degrees. See boundsToBbox for the form it comes out in.
  it('reports an area straddling the antimeridian as the strait it covers', async () => {
    const { el, map } = await renderOverview();
    map.unproject = ([x, y]: [number, number]) => new LngLat(x > 0 ? -175 : 175, -y);
    const areas: [number, number, number, number][] = [];
    el.addEventListener('boundsChange', event => areas.push((event as CustomEvent<[number, number, number, number]>).detail));

    el.search(new Point(-10, 10), new Point(10, 40));

    expect(areas).toEqual([[175, -40, -175, -10]]);
  });

  // Screen y and latitude only run together while the pole is off screen. Pan one into view on a globe
  // and a line of pixels crosses it, so the higher pixel can be the lower latitude - and a box dragged
  // over the pole would otherwise come out with its south edge north of its north edge, which is a
  // bbox no query can answer.
  it('reports a box dragged over a pole the right way up', async () => {
    const { el, map } = await renderOverview();
    // The far side of the pole, where latitude starts coming back down again
    map.unproject = ([, y]: [number, number]) => new LngLat(0, y < 20 ? 80 : 88);
    const areas: [number, number, number, number][] = [];
    el.addEventListener('boundsChange', event => areas.push((event as CustomEvent<[number, number, number, number]>).detail));

    el.search(new Point(10, 10), new Point(30, 40));

    const [[, south, , north]] = areas;
    expect(south).toBeLessThan(north);
    expect([south, north]).toEqual([80, 88]);
  });

  // Under MapLibre's own line between a click and a drag, no rectangle was ever drawn - and a search
  // the reader got no sight of is one they didn't ask for
  it('reports nothing for a shift-click that never drew a box', async () => {
    const { el } = await renderOverview();
    const areas: unknown[] = [];
    el.addEventListener('boundsChange', event => areas.push((event as CustomEvent).detail));

    el.search(new Point(10, 10), new Point(11, 11));

    expect(areas).toEqual([]);
  });

  it('says so, and reports nothing, when it cannot read the area drawn', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { el, map } = await renderOverview();
    // A flat map's unproject can hand back a latitude past a pole, which no bounds can hold
    map.unproject = ([x]: [number, number]) => ({ lng: x, lat: 120 }) as LngLat;
    const areas: unknown[] = [];
    el.addEventListener('boundsChange', event => areas.push((event as CustomEvent).detail));

    el.search(new Point(10, 10), new Point(30, 40));

    expect(areas).toEqual([]);
    expect(consoleWarn).toHaveBeenCalled();
    consoleWarn.mockRestore();
  });
});

describe('ogm-overview theme', () => {
  it('draws the same results into the style document a theme swap empties', async () => {
    const { el, map } = await renderOverview();
    el.records = [record('one', { dcat_bbox: CALIFORNIA })];
    await el.load();

    el.theme = 'dark';
    const swapped = el.onThemeChange();
    map.fire('style.load');
    await swapped;

    expect(map.setStyle).toHaveBeenCalledWith(darkBasemapStyle);

    // What setStyle would have emptied, emptied - and then drawn again by the load that follows it
    map.layers.clear();
    map.sources.clear();
    await el.handleStyleLoad();

    expect(layerIds(map)).toEqual(ALL_LAYERS);
  });
});

// componentDidLoad waits for its container to have a box, which lands in a later task than the one
// that rendered - so there is a window in which the overview can be taken off the page while it is
// still waiting. Nothing may start observing the container after that: whenSized gives up only once
// the container has a box, and a detached one never gets one, so the observer would outlive the component.
describe('ogm-overview taken off the page while it waits', () => {
  // Mounted without being handed a map, so componentDidLoad is left where it really parks
  const mount = async () => {
    const container = document.createElement('div');
    containers.push(container);
    document.body.appendChild(container);
    await stencilRender(<ogm-overview></ogm-overview>, container);
    const el = container.firstElementChild as Overview & { componentOnReady?: () => Promise<unknown> };
    await el.componentOnReady?.();
    consoleError.mockClear();
    return { container, el };
  };

  // Counts what gets observed, since that is the thing that outlives the component
  const countObservers = () => {
    const real = globalThis.ResizeObserver;
    const built: unknown[] = [];
    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        built.push(callback);
        return new real(callback);
      }
    } as unknown as typeof ResizeObserver;
    return { built, restore: () => (globalThis.ResizeObserver = real) };
  };

  // Driven by hand rather than by whatever the environment does with a lifecycle method, so where it
  // has got to when the overview comes off the page is not left to chance
  const didLoad = async (el: Overview) => {
    void el.componentDidLoad();
    await new Promise(resolve => setTimeout(resolve, 0));
  };

  it('waits for a box of its own', async () => {
    const { el } = await mount();

    const observers = countObservers();
    await didLoad(el);
    observers.restore();

    expect(observers.built.length).toBeGreaterThan(0);
  });

  it('observes nothing once it has been taken off the page', async () => {
    const { container, el } = await mount();
    container.remove();

    const observers = countObservers();
    await didLoad(el);
    observers.restore();

    expect(observers.built).toEqual([]);
    expect(el.map).toBeUndefined();
  });
});
