import { describe, it, expect, h, vi, beforeEach, afterEach } from '@stencil/vitest';

import { render as stencilRender } from '@stencil/core';
import { LngLat, Point, type FitBoundsOptions, type LngLatBounds, type LngLatBoundsLike } from 'maplibre-gl';

import { boundsToBbox } from '../../lib/geometry';
import { adoptWebAwesomeTheme } from '../../lib/init';
import LocationPreviewer from '../../lib/previewers/location';
import OgmRecord, { type GeoBlacklightSchemaAardvark } from '../../lib/record';
import LocationResource from '../../lib/resources/location';
import { HIGHLIGHT_BOUNDS, markerImageId, RESULT_MARKERS, RESULT_NUMBERS, SEARCH_BOUNDS } from '../../lib/results';
import MapLibreTheme, { darkBasemapStyle } from '../../lib/themes/maplibre';

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

  boxZoom = { enable: vi.fn(), disable: vi.fn(), isEnabled: vi.fn(() => true), isActive: vi.fn(() => false), reset: vi.fn() };

  cooperativeGestures = { enable: vi.fn(), disable: vi.fn() };

  projection: { type: string } | undefined = undefined;
  setProjection = vi.fn((spec: { type: string }) => (this.projection = spec));
  getProjection() {
    return this.projection;
  }

  unproject([x, y]: [number, number]) {
    return new LngLat(x, -y);
  }

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
  private delegated(event: string, layer: unknown, listener?: (event: unknown) => void): [string, (event: unknown) => void] {
    return listener ? [`${event}:${layer}`, listener] : [event, layer as (event: unknown) => void];
  }
  fire(event: string, data: unknown = {}) {
    [...(this.listeners[event] ?? [])].forEach(listener => listener(data));
    [...(this.onceListeners[event] ?? []).splice(0)].forEach(listener => listener(data));
  }

  once(event: string, listener: (event: unknown) => void) {
    if (event === 'moveend') return listener({});
    (this.onceListeners[event] ??= []).push(listener);
  }

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
  darkBasemap?: string;
  lightBasemap?: string;
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
  cooperativeGestures: boolean;
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
  onCooperativeGesturesChange: () => void;
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

const renderOverview = async () => {
  const container = document.createElement('div');
  containers.push(container);
  document.body.appendChild(container);
  await stencilRender(<ogm-overview></ogm-overview>, container);

  const el = container.firstElementChild as Overview & { componentOnReady?: () => Promise<unknown> };
  await el.componentOnReady?.();
  consoleError.mockClear();

  const map = new FakeMap();
  Object.assign(el, { map, mapTheme: new MapLibreTheme(el, 'light'), mapStyleLoaded: true });
  return { el, map };
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

const MARKER_LAYERS = [RESULT_MARKERS];
const BOX_LAYERS = (id: string) => [`${id}-fill`, `${id}-outline`];

const ALL_LAYERS = [...BOX_LAYERS(SEARCH_BOUNDS), ...BOX_LAYERS(HIGHLIGHT_BOUNDS), ...MARKER_LAYERS];

const drawnBox = (map: FakeMap, id: string) => (map.sources.get(id)?.data.features ?? []).length > 0;

const layerIds = (map: FakeMap) => [...map.layers.keys()];
const marked = (map: FakeMap) => map.sources.get(RESULT_NUMBERS).data.features.map((feature: GeoJSON.Feature) => feature.properties);
const pointAt = (map: FakeMap, ...labels: string[]) => map.fire(`mousemove:${RESULT_MARKERS}`, { features: labels.map(label => ({ properties: { label } })) });
const pointAway = (map: FakeMap) => map.fire(`mouseleave:${RESULT_MARKERS}`);

const highlightedLabels = (map: FakeMap): string[] =>
  marked(map)
    .filter((properties: { highlighted: boolean }) => properties.highlighted)
    .map((properties: { label: string }) => properties.label);
const highlightedLabel = (map: FakeMap) => highlightedLabels(map)[0];

const framed = (map: FakeMap) => map.fitBounds.mock.calls.at(-1) as [LngLatBoundsLike, FitBoundsOptions];

const frameOf = (map: FakeMap): [number, number, number, number] => {
  const [bounds] = framed(map);
  if (!Array.isArray(bounds)) return boundsToBbox(bounds as LngLatBounds);

  const [[west, south], [east, north]] = bounds as [[number, number], [number, number]];
  return [west, south, east, north];
};

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('ogm-overview', () => {
  it('draws a numbered marker for every record it can place', async () => {
    const { el, map } = await renderOverview();
    el.records = [record('one', { dcat_bbox: CALIFORNIA }), record('two', { dcat_bbox: ICELAND })];
    await el.load();

    expect(marked(map).map((properties: { label: string }) => properties.label)).toEqual(['1', '2']);
    expect(layerIds(map)).toEqual(ALL_LAYERS);
  });

  it('draws nothing of a result but its number', async () => {
    const { el, map } = await renderOverview();
    el.records = [record('one', { dcat_bbox: CALIFORNIA })];
    await el.load();

    expect(drawnBox(map, SEARCH_BOUNDS)).toBe(false);
    expect(drawnBox(map, HIGHLIGHT_BOUNDS)).toBe(false);
  });

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
    expect(layerIds(map)).toEqual(ALL_LAYERS);
  });

  it('shows the whole world when it has no records to place', async () => {
    const { el, map } = await renderOverview();
    el.records = [];
    await el.load();

    expect(frameOf(map)).toEqual([-90, -85, 90, 85]);
  });

  it('opens on a globe, whatever it has to show', async () => {
    const { el, map } = await renderOverview();
    el.records = [record('one', { dcat_bbox: CALIFORNIA }), record('two', { dcat_bbox: ICELAND })];
    el.mapStyleLoaded = false;
    await el.handleStyleLoad();

    expect(map.setProjection).toHaveBeenCalledWith({ type: 'globe' });
    expect(map.setProjection.mock.invocationCallOrder[0]).toBeLessThan(map.fitBounds.mock.invocationCallOrder[0]);
    expect(map.setSky).toHaveBeenCalled();
  });

  it('keeps the globe a style document resets on its way in', async () => {
    const { el, map } = await renderOverview();
    el.mapStyleLoaded = false;

    map.projection = { type: 'mercator' };
    await el.handleProjectionTransition();

    expect(map.fitBounds).not.toHaveBeenCalled();

    await el.handleStyleLoad();

    expect(map.setProjection).toHaveBeenCalledWith({ type: 'globe' });
  });

  it('keeps the globe through a swap asked for before its first style had loaded', async () => {
    const { el, map } = await renderOverview();
    el.records = [record('one', { dcat_bbox: CALIFORNIA })];
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
    const { el, map } = await renderOverview();
    el.projection = 'mercator';
    el.mapStyleLoaded = false;
    await el.handleStyleLoad();

    expect(map.setProjection).toHaveBeenCalledWith({ type: 'mercator' });
  });

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

  it('frames what it drew again when the reader changes projection', async () => {
    const { el, map } = await renderOverview();
    el.records = [record('the-world', { dcat_bbox: THE_WORLD })];
    await el.load();
    const framedOnce = map.fitBounds.mock.calls.length;

    map.projection = { type: 'mercator' };
    await el.handleProjectionTransition();

    expect(map.fitBounds.mock.calls.length).toBeGreaterThan(framedOnce);
    expect(frameOf(map)).toEqual([-180, -85, 180, 85]);
  });

  it('opens on the extents it goes on to frame', async () => {
    const { el } = await renderOverview();
    el.records = [record('one', { dcat_bbox: CALIFORNIA }), record('nowhere'), record('two', { locn_geometry: 'POINT(-122.17 37.43)' })];

    const opening = el.declaredExtents();
    await el.load();

    expect(opening).toEqual(el.extents);
  });

  it('opens no closer than city scale, whatever it was asked to frame', async () => {
    const { el, map } = await renderOverview();
    el.records = [record('a-point', { locn_geometry: 'POINT(-122.17 37.43)' })];
    await el.load();

    expect(framed(map)[1].maxZoom).toEqual(12);
  });

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
    consoleWarn.mockClear();
    await el.load();

    expect(consoleWarn).toHaveBeenCalledWith('Could not read searchBounds:', 'somewhere nice');
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

  it('draws nothing for it', async () => {
    const { el, map } = await renderOverview();
    el.viewBounds = CALIFORNIA;
    await el.load();

    expect(drawnBox(map, SEARCH_BOUNDS)).toBe(false);
    expect(layerIds(map)).toEqual(ALL_LAYERS);
  });

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

  it('brings the result it was pointed at to the front, in the colors of a highlight', async () => {
    const { el, map } = await two();
    el.highlighted = 2;
    el.onHighlightedChange();

    expect(highlightedLabel(map)).toEqual('2');
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

  it('highlights a place written down, which is what an attribute hands over', async () => {
    const { el, map } = await two();
    el.setAttribute('highlighted', '2');

    expect(el.highlighted).toEqual('2');
    el.onHighlightedChange();

    expect(highlightedLabel(map)).toEqual('2');
  });

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

  it('highlights nothing for a result it has nowhere to put', async () => {
    const { el, map } = await renderOverview();
    el.records = [record('one', { dcat_bbox: CALIFORNIA }), record('nowhere')];
    await el.load();

    el.highlighted = 2;
    el.onHighlightedChange();

    expect(highlightedLabel(map)).toBeUndefined();
    expect(drawnBox(map, HIGHLIGHT_BOUNDS)).toBe(false);
  });

  it('highlights nothing it cannot find', async () => {
    const { el, map } = await two();

    for (const value of ['nope', 99, 0, -1, '', 1.5]) {
      el.highlighted = value as number | string;
      el.onHighlightedChange();

      expect(highlightedLabel(map)).toBeUndefined();
      expect(drawnBox(map, HIGHLIGHT_BOUNDS)).toBe(false);
    }
  });

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
  const hovering = async () => {
    const rendered = await renderOverview();
    rendered.el.records = [record('one', { dcat_bbox: CALIFORNIA }), record('two', { dcat_bbox: ICELAND })];
    await rendered.el.load();
    rendered.el.followPointer();

    const reported: unknown[] = [];
    rendered.el.addEventListener('highlightChange', event => reported.push((event as CustomEvent).detail));

    return { ...rendered, reported };
  };

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

  it('highlights the number drawn on top where two of them overlap', async () => {
    const { map } = await hovering();
    pointAt(map, '2', '1');

    expect(highlightedLabels(map)).toEqual(['1']);
  });

  it('highlights what the page named and what the pointer is over', async () => {
    const { el, map } = await hovering();
    el.highlighted = 1;
    el.onHighlightedChange();
    pointAt(map, '2');

    expect(highlightedLabels(map)).toEqual(['1', '2']);
    expect(map.sources.get(HIGHLIGHT_BOUNDS).data.features).toHaveLength(2);
  });

  it('redraws nothing while the pointer stays on the same number', async () => {
    const { map } = await hovering();
    pointAt(map, '2');
    const setData = vi.spyOn(map.sources.get(RESULT_NUMBERS), 'setData');

    pointAt(map, '2');
    pointAt(map, '2');

    expect(setData).not.toHaveBeenCalled();
  });

  it('leaves the camera where it is when the pointer moves', async () => {
    const { map } = await hovering();
    const framed = map.fitBounds.mock.calls.length;

    pointAt(map, '2');

    expect(map.fitBounds.mock.calls.length).toEqual(framed);
  });

  it('forgets what the pointer was over when the results change', async () => {
    const { el, map } = await hovering();
    pointAt(map, '2');

    el.records = [record('three', { dcat_bbox: ICELAND })];
    await el.onRecordsChange();

    expect(highlightedLabels(map)).toEqual([]);
  });

  it('says which result the pointer is over, by place and by id', async () => {
    const { map, reported } = await hovering();
    pointAt(map, '2');

    expect(reported).toEqual([{ place: 2, id: 'two' }]);
  });

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

  it('says nothing when the highlight is set from outside', async () => {
    const { el, reported } = await hovering();
    el.highlighted = 2;
    el.onHighlightedChange();

    el.highlighted = undefined;
    el.onHighlightedChange();

    expect(reported).toEqual([]);
  });

  it('says the pointer is over nothing when the results change under it', async () => {
    const { el, map, reported } = await hovering();
    pointAt(map, '2');

    el.records = [record('three', { dcat_bbox: ICELAND })];
    await el.onRecordsChange();

    expect(reported).toEqual([{ place: 2, id: 'two' }, null]);
  });

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

  it('reports an area straddling the antimeridian as the strait it covers', async () => {
    const { el, map } = await renderOverview();
    map.unproject = ([x, y]: [number, number]) => new LngLat(x > 0 ? -175 : 175, -y);
    const areas: [number, number, number, number][] = [];
    el.addEventListener('boundsChange', event => areas.push((event as CustomEvent<[number, number, number, number]>).detail));

    el.search(new Point(-10, 10), new Point(10, 40));

    expect(areas).toEqual([[175, -40, -175, -10]]);
  });

  it('reports a box dragged over a pole the right way up', async () => {
    const { el, map } = await renderOverview();
    map.unproject = ([, y]: [number, number]) => new LngLat(0, y < 20 ? 80 : 88);
    const areas: [number, number, number, number][] = [];
    el.addEventListener('boundsChange', event => areas.push((event as CustomEvent<[number, number, number, number]>).detail));

    el.search(new Point(10, 10), new Point(30, 40));

    const [[, south, , north]] = areas;
    expect(south).toBeLessThan(north);
    expect([south, north]).toEqual([80, 88]);
  });

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
    map.unproject = ([x]: [number, number]) => ({ lng: x, lat: 120 }) as LngLat;
    const areas: unknown[] = [];
    el.addEventListener('boundsChange', event => areas.push((event as CustomEvent).detail));

    el.search(new Point(10, 10), new Point(30, 40));

    expect(areas).toEqual([]);
    expect(consoleWarn).toHaveBeenCalled();
    consoleWarn.mockRestore();
  });
});

describe('ogm-overview cooperative gestures', () => {
  it('is on by default', async () => {
    const { el } = await renderOverview();
    expect(el.cooperativeGestures).toBe(true);
  });

  it('answers a wheel or a single touch right away only once turned off', async () => {
    const { el, map } = await renderOverview();
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

    map.layers.clear();
    map.sources.clear();
    await el.handleStyleLoad();

    expect(layerIds(map)).toEqual(ALL_LAYERS);
  });

  it('swaps in a caller’s own basemap for the mode it names one for', async () => {
    const { el, map } = await renderOverview();

    el.theme = 'dark';
    el.darkBasemap = 'https://example.com/dark.json';
    const swapped = el.onThemeChange();
    map.fire('style.load');
    await swapped;

    expect(map.setStyle).toHaveBeenCalledWith('https://example.com/dark.json');
  });
});

describe('ogm-overview taken off the page while it waits', () => {
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
