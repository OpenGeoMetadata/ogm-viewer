import { describe, it, expect, h, vi, beforeEach, afterEach } from '@stencil/vitest';

import { render as stencilRender } from '@stencil/core';
import type { FitBoundsOptions, LngLatBounds, LngLatBoundsLike } from 'maplibre-gl';

import { boundsToBbox } from '../../lib/geometry';
import { adoptWebAwesomeTheme } from '../../lib/init';
import LocationPreviewer from '../../lib/previewers/location';
import OgmRecord, { type GeoBlacklightSchemaAardvark } from '../../lib/record';
import LocationResource from '../../lib/resources/location';
import MapLibreTheme, { darkBasemapStyle } from '../../lib/themes/maplibre';

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

  cooperativeGestures = { enable: vi.fn(), disable: vi.fn() };
  controls: { control: any; position?: string; element: HTMLElement }[] = [];
  listeners: Record<string, ((event: unknown) => void)[]> = {};
  onceListeners: Record<string, ((event: unknown) => void)[]> = {};

  projection: { type: string } | undefined = undefined;
  setProjection = vi.fn((spec: { type: string }) => (this.projection = spec));
  getProjection() {
    return this.projection;
  }

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

const aardvark = (id: string, fields: Partial<GeoBlacklightSchemaAardvark> = {}) =>
  ({
    id,
    dct_title_s: id,
    gbl_resourceClass_sm: ['Datasets'],
    dct_accessRights_s: 'Public',
    gbl_mdVersion_s: 'Aardvark',
    ...fields,
  }) as GeoBlacklightSchemaAardvark;

const record = (id: string, fields: Partial<GeoBlacklightSchemaAardvark> = {}) => new OgmRecord(aardvark(id, fields));

const CALIFORNIA = 'ENVELOPE(-124.41,-114.13,42.01,32.53)';
const THE_WORLD = 'ENVELOPE(-180.0,180.0,85.0,-85.0)';
const ISLANDS = 'MULTIPOLYGON(((-124 42,-114 42,-114 32,-124 32,-124 42)),((-160 22,-155 22,-155 19,-160 19,-160 22)))';

type Locator = HTMLElement & {
  record?: OgmRecord;
  previewer?: LocationPreviewer;
  recordUrl?: string;
  theme: 'light' | 'dark';
  darkBasemap?: string;
  lightBasemap?: string;
  cooperativeGestures: boolean;
  map: FakeMap;
  mapTheme: MapLibreTheme;
  mapStyleLoaded: boolean;
  projection: 'globe' | 'mercator';
  addControls: () => void;
  handleStyleLoad: () => Promise<void>;
  handleProjectionTransition: () => Promise<void>;
  draw: () => Promise<void>;
  frame: () => Promise<void>;
  opening: () => LngLatBoundsLike;
  onRecordChange: () => Promise<void>;
  onThemeChange: () => Promise<void>;
  onCooperativeGesturesChange: () => void;
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

const renderLocator = async () => {
  const container = document.createElement('div');
  containers.push(container);
  document.body.appendChild(container);
  await stencilRender(<ogm-locator></ogm-locator>, container);

  const el = container.firstElementChild as Locator & { componentOnReady?: () => Promise<unknown> };
  await el.componentOnReady?.();
  consoleError.mockClear();

  const map = new FakeMap();
  Object.assign(el, { map, mapTheme: new MapLibreTheme(el, 'light'), mapStyleLoaded: true });
  return { el, map };
};

const drawn = (map: FakeMap) => [...map.layers.keys()];
const framed = (map: FakeMap) => map.fitBounds.mock.calls.at(-1) as [LngLatBoundsLike, FitBoundsOptions];

const frameOf = (map: FakeMap): [number, number, number, number] => {
  const [bounds] = framed(map);
  if (!Array.isArray(bounds)) return boundsToBbox(bounds as LngLatBounds);

  const [[west, south], [east, north]] = bounds as [[number, number], [number, number]];
  return [west, south, east, north];
};

const cssOf = (sheet: CSSStyleSheet): string =>
  Array.from(sheet.cssRules)
    .map(rule => rule.cssText)
    .join('\n');

const webAwesomeTheme = (): string => {
  const root = document.createElement('div').attachShadow({ mode: 'open' });
  adoptWebAwesomeTheme(root.host);
  return cssOf(root.adoptedStyleSheets[0]);
};

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

  it('opens on the view it goes on to frame', async () => {
    const { el, map } = await renderLocator();
    el.record = record('one', { dcat_bbox: CALIFORNIA });

    const [[west, south], [east, north]] = el.opening() as [[number, number], [number, number]];
    await el.draw();

    expect([west, south, east, north]).toEqual(frameOf(map));
  });

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
    expect(map.setProjection.mock.invocationCallOrder[0]).toBeLessThan(map.fitBounds.mock.invocationCallOrder[0]);
    expect(map.setSky).toHaveBeenCalled();
  });

  it('holds a location wider than a hemisphere to the half of the world around it', async () => {
    const { el, map } = await renderLocator();
    el.record = record('the-world', { dcat_bbox: THE_WORLD });
    await el.draw();

    expect(frameOf(map)).toEqual([-90, -85, 90, 85]);
    expect(drawn(map)).toEqual(['the-world-location-fill', 'the-world-location-outline']);
  });

  it('frames the whole of a wide location once the reader flattens the map', async () => {
    const { el, map } = await renderLocator();
    el.record = record('the-world', { dcat_bbox: THE_WORLD });
    await el.draw();

    map.projection = { type: 'mercator' };
    await el.handleProjectionTransition();

    expect(frameOf(map)).toEqual([-180, -85, 180, 85]);
  });

  it('reads a vertical perspective as the globe it is', async () => {
    const { el, map } = await renderLocator();
    el.record = record('the-world', { dcat_bbox: THE_WORLD });
    await el.draw();

    map.projection = { type: 'vertical-perspective' };
    await el.handleProjectionTransition();

    expect(frameOf(map)).toEqual([-90, -85, 90, 85]);
  });

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

  it('keeps the globe through a swap asked for before its first style had loaded', async () => {
    const { el, map } = await renderLocator();
    el.record = record('one', { dcat_bbox: CALIFORNIA });
    el.mapStyleLoaded = false;

    el.theme = 'dark';
    const swapped = el.onThemeChange();
    map.fire('style.load');
    await swapped;

    await el.handleStyleLoad();

    expect(map.setProjection).toHaveBeenLastCalledWith({ type: 'globe' });

    map.projection = { type: 'mercator' };
    await el.handleProjectionTransition();
    await el.handleStyleLoad();

    expect(map.setProjection).toHaveBeenLastCalledWith({ type: 'globe' });
  });

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

    map.layers.clear();
    map.sources.clear();
    await el.handleStyleLoad();

    expect(drawn(map)).toEqual(['one-location-fill', 'one-location-outline']);
  });

  it('swaps in a caller’s own basemap for the mode it names one for', async () => {
    const { el, map } = await renderLocator();

    el.theme = 'dark';
    el.darkBasemap = 'https://example.com/dark.json';
    const swapped = el.onThemeChange();
    map.fire('style.load');
    await swapped;

    expect(map.setStyle).toHaveBeenCalledWith('https://example.com/dark.json');
  });

  it('takes its map down with it', async () => {
    const { el, map } = await renderLocator();
    (el as unknown as { disconnectedCallback: () => void }).disconnectedCallback();

    expect(map.remove).toHaveBeenCalled();
  });

  it('carries the Web Awesome scope, being usable on its own', async () => {
    const { el } = await renderLocator();

    expect(el.className).toContain('wa-palette-default');
    expect((el.shadowRoot as ShadowRoot).adoptedStyleSheets.map(cssOf)).toContain(webAwesomeTheme());
  });
});

const mount = async (recordUrl: string) => {
  const container = document.createElement('div');
  containers.push(container);
  document.body.appendChild(container);
  await stencilRender(<ogm-locator recordUrl={recordUrl}></ogm-locator>, container);
  const el = container.firstElementChild as Locator;
  await flush();
  return el;
};

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('ogm-locator, given a URL instead of a record', () => {
  afterEach(() => vi.restoreAllMocks());

  it('fetches it and draws from what comes back, the same as a record handed over directly', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(aardvark('one', { dcat_bbox: CALIFORNIA }))));

    const el = await mount('https://example.com/one.json');

    expect(el.record?.id).toEqual('one');
    expect(el.record?.getGeometry()).toEqual(record('one', { dcat_bbox: CALIFORNIA }).getGeometry());
  });

  it('asks the URL it was given, unchanged', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(aardvark('one'))));

    await mount('https://example.com/one.json');

    expect(fetchSpy.mock.calls[0][0]).toEqual('https://example.com/one.json');
  });

  it('logs a fetch that fails rather than throwing, and leaves record unset', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('not found', { status: 404 }));

    const el = await mount('https://example.com/missing.json');

    expect(el.record).toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('https://example.com/missing.json'), expect.anything());
  });

  it('fetches again when the URL changes', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(aardvark('one'))))
      .mockResolvedValueOnce(new Response(JSON.stringify(aardvark('two'))));

    const el = await mount('https://example.com/one.json');
    el.recordUrl = 'https://example.com/two.json';
    await flush();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(el.record?.id).toEqual('two');
  });
});

describe('ogm-locator controls', () => {
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

describe('ogm-locator cooperative gestures', () => {
  it('is on by default', async () => {
    const { el } = await renderLocator();
    expect(el.cooperativeGestures).toBe(true);
  });

  it('answers a wheel or a single touch right away only once turned off', async () => {
    const { el, map } = await renderLocator();
    el.cooperativeGestures = false;
    el.onCooperativeGesturesChange();

    expect(map.cooperativeGestures.disable).toHaveBeenCalled();
    expect(map.cooperativeGestures.enable).not.toHaveBeenCalled();

    map.cooperativeGestures.disable.mockClear();
    el.cooperativeGestures = true;
    el.onCooperativeGesturesChange();

    expect(map.cooperativeGestures.enable).toHaveBeenCalled();
    expect(map.cooperativeGestures.disable).not.toHaveBeenCalled();
  });
});

describe('ogm-locator taken off the page while it waits', () => {
  const mount = async () => {
    const container = document.createElement('div');
    containers.push(container);
    document.body.appendChild(container);
    await stencilRender(<ogm-locator></ogm-locator>, container);
    const el = container.firstElementChild as Locator & { componentOnReady?: () => Promise<unknown> };
    await el.componentOnReady?.();
    consoleError.mockClear();
    return { container, el };
  };

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

  const didLoad = async (el: Locator) => {
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
