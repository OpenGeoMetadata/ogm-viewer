import { describe, it, expect, h, vi, beforeEach, afterEach } from '@stencil/vitest';

// Rendered with Stencil's low-level render rather than @stencil/vitest's `render` wrapper, for the
// same reason ogm-overview's tests are: the wrapper re-throws whatever a lifecycle method leaves
// behind. componentDidLoad never gets as far as a map here - happy-dom lays nothing out, so the
// container never has the box whenSized waits for. What's under test is what happens once a map
// exists, so one is handed to the component afterwards.
import { render as stencilRender } from '@stencil/core';

import { boundsToBbox } from '../../lib/geometry';
import LocationPreviewer from '../../lib/previewers/location';
import OgmRecord, { type GeoBlacklightSchemaAardvark } from '../../lib/record';
import LocationResource from '../../lib/resources/location';
import MapLibreTheme, { darkBasemapStyle } from '../../lib/themes/maplibre';

// Enough of a MapLibre map to draw one location on, to be pointed at it, and to hang the three
// controls off. MapLibre's own controls read a good deal of this as they are added - the titles to
// label themselves with, the zoom limits to grey their buttons at, the projection to show, the
// container to measure - because addControl below really runs onAdd.
class FakeMap {
  sources = new Map<string, any>();
  layers = new Map<string, any>();
  fitBounds = vi.fn();
  setSky = vi.fn();
  setStyle = vi.fn();
  remove = vi.fn();
  style = { stylesheet: undefined as unknown, tileManagers: {} as Record<string, unknown> };
  keyboard = { disableRotation: vi.fn() };
  touchZoomRotate = { disableRotation: vi.fn() };
  controls: { control: any; position?: string; element: HTMLElement }[] = [];
  listeners: Record<string, ((event: unknown) => void)[]> = {};
  onceListeners: Record<string, ((event: unknown) => void)[]> = {};

  // Written and read back, rather than recorded: which projection the map is in is what decides
  // whether the camera clamps, and the globe button's own state is read straight off it
  projection: { type: string } | undefined = undefined;
  setProjection = vi.fn((spec: { type: string }) => (this.projection = spec));
  getProjection() {
    return this.projection;
  }

  // Resolving the corner the way Map.addControl does, so where a control lands can be asserted:
  // whatever it was given, else whatever the control asks for, else top right.
  addControl(control: any, position?: string) {
    this.controls.push({ control, position: position ?? control.getDefaultPosition?.() ?? 'top-right', element: control.onAdd(this) });
  }
  on(event: string, listener: (event: unknown) => void) {
    (this.listeners[event] ??= []).push(listener);
  }
  off(event: string, listener: (event: unknown) => void) {
    this.listeners[event] = (this.listeners[event] ?? []).filter(bound => bound !== listener);
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

  getSource(id: string) {
    return this.sources.get(id);
  }
  addSource(id: string, spec: any) {
    this.sources.set(id, spec);
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
const THE_WORLD = 'ENVELOPE(-180.0,180.0,85.0,-85.0)';
// An archipelago and a coastline, so the shape and the box around it are two different claims
const ISLANDS = 'MULTIPOLYGON(((-124 42,-114 42,-114 32,-124 32,-124 42)),((-160 22,-155 22,-155 19,-160 19,-160 22)))';

type Locator = HTMLElement & {
  record?: OgmRecord;
  previewer?: LocationPreviewer;
  theme: 'light' | 'dark';
  map: FakeMap;
  mapTheme: MapLibreTheme;
  mapStyleLoaded: boolean;
  projection: 'globe' | 'mercator';
  addControls: () => void;
  handleStyleLoad: () => Promise<void>;
  handleProjectionTransition: () => Promise<void>;
  draw: () => Promise<void>;
  frame: () => Promise<void>;
  onRecordChange: () => Promise<void>;
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
const renderLocator = async () => {
  const container = document.createElement('div');
  containers.push(container);
  document.body.appendChild(container);
  await stencilRender(<ogm-locator></ogm-locator>, container);

  const el = container.firstElementChild as Locator & { componentOnReady?: () => Promise<unknown> };
  await el.componentOnReady?.();
  // Anything componentDidLoad reported on the way up is the WebGL gap, not what's under test
  consoleError.mockClear();

  const map = new FakeMap();
  Object.assign(el, { map, mapTheme: new MapLibreTheme(el, 'light'), mapStyleLoaded: true });
  return { el, map };
};

const drawn = (map: FakeMap) => [...map.layers.keys()];
const framed = (map: FakeMap) => map.fitBounds.mock.calls.at(-1) as [maplibregl.LngLatBoundsLike, maplibregl.FitBoundsOptions];

// Where the camera was pointed, as west, south, east, north. Two shapes arrive: a camera held to what
// a globe can face is a LngLatBounds, and one that needed no holding is the pair of corners the
// resource carries. Each is read as it is rather than put through LngLatBounds.convert, because the
// bounds a component built came out of the built bundle and so is not an instance of the class this
// file's own import names - convert would take it for an array and hand back something broken.
const frameOf = (map: FakeMap): [number, number, number, number] => {
  const [bounds] = framed(map);
  if (!Array.isArray(bounds)) return boundsToBbox(bounds as maplibregl.LngLatBounds);

  const [[west, south], [east, north]] = bounds as [[number, number], [number, number]];
  return [west, south, east, north];
};

// The basemap's own credit arriving, which is what MapLibre would answer by opening the panel
const credit = (map: FakeMap) => {
  map.style.stylesheet = {};
  map.style.tileManagers = { basemap: { used: true, getSource: () => ({ attribution: '© CARTO' }) } };
  map.fire('sourcedata', { dataType: 'source', sourceDataType: 'metadata' });
};

describe('ogm-locator', () => {
  it('draws where the record says it is', async () => {
    const { el, map } = await renderLocator();
    el.record = record('one', { dcat_bbox: CALIFORNIA });
    await el.draw();

    expect(drawn(map)).toEqual(['one-location-fill', 'one-location-outline']);
    expect(frameOf(map)).toEqual([-124.41, 32.53, -114.13, 42.01]);
  });

  // Which is what "the geometry or the bounding box, as appropriate" means: squaring an archipelago
  // off to its envelope claims a stretch of ocean the record says nothing about.
  it('draws the shape a record carries rather than the box around it', async () => {
    const { el, map } = await renderLocator();
    el.record = record('one', { locn_geometry: ISLANDS, dcat_bbox: CALIFORNIA });
    await el.draw();

    expect(map.sources.get('one-location').data.geometry.type).toEqual('MultiPolygon');
  });

  it('draws the location it was handed instead of the record’s own', async () => {
    const { el, map } = await renderLocator();
    el.record = record('one', { dcat_bbox: CALIFORNIA });
    el.previewer = new LocationPreviewer(new LocationResource('handed-over', { type: 'Point', coordinates: [0, 0] }));
    await el.draw();

    expect(drawn(map)).toEqual(['handed-over-location-fill', 'handed-over-location-outline']);
    expect(map.sources.has('one-location')).toBe(false);
  });

  it('takes the last location off the map before drawing the next', async () => {
    const { el, map } = await renderLocator();
    el.record = record('one', { dcat_bbox: CALIFORNIA });
    await el.draw();

    el.record = record('two', { dcat_bbox: THE_WORLD });
    await el.onRecordChange();

    expect(drawn(map)).toEqual(['two-location-fill', 'two-location-outline']);
    expect(map.sources.has('one-location')).toBe(false);
  });

  // A record can be ordinary metadata with nothing to place it by. That is not a failure, so it gets
  // a map of everywhere rather than an empty pane or a complaint.
  it('shows the world for a record that does not say where it is', async () => {
    const { el, map } = await renderLocator();
    el.record = record('nowhere');
    await el.draw();

    expect(drawn(map)).toEqual([]);
    expect(frameOf(map)).toEqual([-90, -85, 90, 85]);
  });

  it('shows the world when it has nothing at all to place', async () => {
    const { el, map } = await renderLocator();
    await el.draw();

    expect(drawn(map)).toEqual([]);
    expect(map.fitBounds).toHaveBeenCalled();
  });

  it('opens on a globe', async () => {
    const { el, map } = await renderLocator();
    el.record = record('one', { dcat_bbox: CALIFORNIA });
    el.mapStyleLoaded = false;
    await el.handleStyleLoad();

    expect(map.setProjection).toHaveBeenCalledWith({ type: 'globe' });
    // The order matters: whether the camera clamps is read off the projection it is pointed in
    expect(map.setProjection.mock.invocationCallOrder[0]).toBeLessThan(map.fitBounds.mock.invocationCallOrder[0]);
    expect(map.setSky).toHaveBeenCalled();
  });

  // A globe camera has no answer for anything wider than the half of the world facing it, and would
  // leave the camera where it was rather than say so
  it('holds a location wider than a hemisphere to the half of the world around it', async () => {
    const { el, map } = await renderLocator();
    el.record = record('the-world', { dcat_bbox: THE_WORLD });
    await el.draw();

    expect(frameOf(map)).toEqual([-90, -85, 90, 85]);
    expect(drawn(map)).toEqual(['the-world-location-fill', 'the-world-location-outline']);
  });

  // Which is what the globe button is for on a locator: the whole of a record too wide to fit on a
  // sphere is only visible on a flat map, so switching to one re-frames rather than staying halved.
  it('frames the whole of a wide location once the reader flattens the map', async () => {
    const { el, map } = await renderLocator();
    el.record = record('the-world', { dcat_bbox: THE_WORLD });
    await el.draw();

    // The map is already flat by the time it says so: MapLibre changes the projection and announces
    // the change afterwards, and what the camera does is read off the map rather than off the news
    map.projection = { type: 'mercator' };
    await el.handleProjectionTransition();

    expect(frameOf(map)).toEqual([-180, -85, 180, 85]);
  });

  // MapLibre has two names for a sphere: 'globe' draws as one until it is zoomed in far enough that a
  // sphere and a flat map are the same picture, and 'vertical-perspective' stays one throughout.
  it('reads a vertical perspective as the globe it is', async () => {
    const { el, map } = await renderLocator();
    el.record = record('the-world', { dcat_bbox: THE_WORLD });
    await el.draw();

    map.projection = { type: 'vertical-perspective' };
    await el.handleProjectionTransition();

    expect(frameOf(map)).toEqual([-90, -85, 90, 85]);
  });

  // A style loading is itself a projection change: it ends by setting whatever it names, and neither
  // basemap names anything, so every style document arrives flat. Read as the reader's own choice,
  // that flattened a globe on every theme swap.
  it('keeps the globe a style document resets on its way in', async () => {
    const { el, map } = await renderLocator();
    el.record = record('one', { dcat_bbox: CALIFORNIA });
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
    const { el, map } = await renderLocator();
    el.record = record('one', { dcat_bbox: CALIFORNIA });
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

  // A style document carries its own projection and neither basemap names one, so every swap arrives
  // flat - and would take a globe the reader had chosen with it
  it('opens in the projection the reader last chose, after a change of theme', async () => {
    const { el, map } = await renderLocator();
    el.projection = 'mercator';
    el.mapStyleLoaded = false;
    await el.handleStyleLoad();

    expect(map.setProjection).toHaveBeenCalledWith({ type: 'mercator' });
  });

  it('holds what it frames away from the edge of the map', async () => {
    const { el, map } = await renderLocator();
    el.record = record('one', { dcat_bbox: CALIFORNIA });
    await el.draw();

    const [, options] = framed(map);
    expect(options.padding).toEqual(el.mapTheme.getOverviewPadding());
    expect(options.padding).toBeGreaterThan(el.mapTheme.getPadding());
  });

  // A point is a box with no width, so unasked MapLibre settles for the map's own maxZoom of 22 -
  // which is a street, on a map whose job is to say roughly where in the world something is
  it('opens no closer than city scale, whatever it was asked to frame', async () => {
    const { el, map } = await renderLocator();
    el.record = record('a-point', { locn_geometry: 'POINT(-122.17 37.43)' });
    await el.draw();

    expect(framed(map)[1].maxZoom).toEqual(12);
  });

  it('draws the same location into the style document a theme swap empties', async () => {
    const { el, map } = await renderLocator();
    el.record = record('one', { dcat_bbox: CALIFORNIA });
    await el.draw();

    el.theme = 'dark';
    const swapped = el.onThemeChange();
    map.fire('style.load');
    await swapped;

    expect(map.setStyle).toHaveBeenCalledWith(darkBasemapStyle);

    // What setStyle would have emptied, emptied - and then drawn again by the load that follows it
    map.layers.clear();
    map.sources.clear();
    await el.handleStyleLoad();

    expect(drawn(map)).toEqual(['one-location-fill', 'one-location-outline']);
  });

  it('takes its map down with it', async () => {
    const { el, map } = await renderLocator();
    (el as unknown as { disconnectedCallback: () => void }).disconnectedCallback();

    expect(map.remove).toHaveBeenCalled();
  });

  it('carries the Web Awesome scope, being usable on its own', async () => {
    const { el } = await renderLocator();

    expect(el.className).toContain('wa-palette-default');
    expect((el.shadowRoot as ShadowRoot).querySelector('link[rel="stylesheet"]')).toBeTruthy();
  });
});

describe('ogm-locator controls', () => {
  // The no-pitch test as much as the zoom one: with no compass there is no control that can turn or
  // tilt the map, which is what the compass button and its pitch visualiser are for
  it('offers zoom buttons and no compass', async () => {
    const { el, map } = await renderLocator();
    el.addControls();

    const { element } = map.controls[0];
    expect(Array.from(element.querySelectorAll('button'), button => button.className)).toEqual(['maplibregl-ctrl-zoom-in', 'maplibregl-ctrl-zoom-out']);
    expect(element.querySelector('.maplibregl-ctrl-compass')).toBeNull();
  });

  it('offers a globe button, so a locator can be flattened', async () => {
    const { el, map } = await renderLocator();
    el.addControls();
    map.fire('style.load');

    const globe = map.controls.find(added => added.element.querySelector('[class^="maplibregl-ctrl-globe"]'));
    expect(globe).toBeTruthy();
    expect(globe!.position).toEqual('top-right');
  });

  it('keeps the credit in the corner as an "i" rather than an open panel', async () => {
    const { el, map } = await renderLocator();
    el.addControls();
    credit(map);

    const attribution = map.controls.find(added => added.element.classList.contains('maplibregl-ctrl-attrib'))!;
    expect(attribution.position).toEqual('bottom-right');
    expect(attribution.element.classList.contains('maplibregl-compact')).toBe(true);
    expect(attribution.element.classList.contains('maplibregl-compact-show')).toBe(false);
    expect(attribution.element.textContent).toContain('CARTO');
  });
});

// componentDidLoad waits on the palette's stylesheet, which lands in a later task than the one that
// rendered - so there is a window in which the locator can be taken off the page while it is still
// waiting. Nothing may start observing the container after that: whenSized gives up only once the
// container has a box, and a detached one never gets one, so the observer would outlive the component.
describe('ogm-locator taken off the page while it waits', () => {
  // Mounted without being handed a map, so componentDidLoad is left where it really parks
  const mount = async () => {
    const container = document.createElement('div');
    containers.push(container);
    document.body.appendChild(container);
    await stencilRender(<ogm-locator></ogm-locator>, container);
    const el = container.firstElementChild as Locator & { componentOnReady?: () => Promise<unknown> };
    await el.componentOnReady?.();
    consoleError.mockClear();
    return { container, el, link: (el.shadowRoot as ShadowRoot).querySelector('link') as HTMLLinkElement };
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

  // Driven by hand rather than by whatever the environment does with the stylesheet, so which of the
  // two arrives first is not left to chance
  const paletteArrives = async (link: HTMLLinkElement, el: Locator) => {
    void el.componentDidLoad();
    link.dispatchEvent(new Event('load'));
    await new Promise(resolve => setTimeout(resolve, 0));
  };

  it('waits for a box of its own once its palette has arrived', async () => {
    const { el, link } = await mount();

    const observers = countObservers();
    await paletteArrives(link, el);
    observers.restore();

    expect(observers.built.length).toBeGreaterThan(0);
  });

  it('observes nothing once it has been taken off the page', async () => {
    const { container, el, link } = await mount();
    container.remove();

    const observers = countObservers();
    await paletteArrives(link, el);
    observers.restore();

    expect(observers.built).toEqual([]);
    expect(el.map).toBeUndefined();
  });
});
