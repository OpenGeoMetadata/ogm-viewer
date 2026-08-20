import { describe, it, expect, h, vi, beforeEach, afterEach } from '@stencil/vitest';

// Rendered with Stencil's low-level render rather than @stencil/vitest's `render` wrapper, for the
// same reason ogm-map's tests are: the wrapper re-throws whatever a lifecycle method leaves behind.
// componentDidLoad never gets as far as a map here - happy-dom lays nothing out, so the container
// never has the box whenSized waits for. What's under test is what happens once a map exists, so one
// is handed to the component afterwards.
import { render as stencilRender } from '@stencil/core';
import { LngLatBounds } from 'maplibre-gl';

import { boundsToBbox, WORLD } from '../../lib/geometry';
import LocationPreviewer from '../../lib/previewers/location';
import OgmRecord, { type GeoBlacklightSchemaAardvark } from '../../lib/record';
import LocationResource from '../../lib/resources/location';
import MapLibreTheme from '../../lib/themes/maplibre';

// Enough of a MapLibre map to draw boxes on and to be pointed at them
class FakeMap {
  sources = new Map<string, any>();
  layers = new Map<string, any>();
  fitBounds = vi.fn();
  setProjection = vi.fn();
  remove = vi.fn();
  controls: { control: any; position?: string; element: HTMLElement }[] = [];
  listeners: Record<string, ((event: unknown) => void)[]> = {};

  // Real enough to build the control against: addControl is what hands it the map it binds to, so a
  // stand-in that only recorded the call would leave the half being tested unrun.
  addControl(control: any, position?: string) {
    this.controls.push({ control, position, element: control.onAdd(this) });
  }
  removeControl(control: any) {
    this.controls = this.controls.filter(added => added.control !== control);
    control.onRemove(this);
  }
  on(event: string, listener: (event: unknown) => void) {
    (this.listeners[event] ??= []).push(listener);
  }
  off(event: string, listener: (event: unknown) => void) {
    this.listeners[event] = (this.listeners[event] ?? []).filter(bound => bound !== listener);
  }
  fire(event: string, data: unknown = {}) {
    [...(this.listeners[event] ?? [])].forEach(listener => listener(data));
  }

  // A view the reader has panned three times east: MapLibre never wraps a camera's bounds, so both
  // edges are out of range and boundsToBbox has something to bring back
  getBounds() {
    return new LngLatBounds([530, -10], [560, 10]);
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
  once(_event: string, listener: () => void) {
    listener();
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
  previewers?: LocationPreviewer[];
  map: FakeMap;
  mapTheme: MapLibreTheme;
  mapStyleLoaded: boolean;
  draw: () => Promise<void>;
  frame: () => Promise<void>;
  onRecordsChange: () => Promise<void>;
  bounds?: number[] | string;
  onBoundsChange: () => Promise<void>;
  geosearch?: 'auto' | 'manual';
  searchHereText: string;
  searchOnMoveText: string;
  onGeosearchChange: () => void;
  onGeosearchLabelsChange: () => void;
  emitBounds: () => void;
  componentDidLoad: () => Promise<void>;
};

// The reader's own hand on the camera; see GeosearchControl.handleCameraEnd
const DROVE = { originalEvent: new MouseEvent('mouseup') };

const containers: HTMLElement[] = [];
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  containers.splice(0).forEach(container => container.remove());
  consoleError.mockRestore();
  vi.useRealTimers();
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

const boxLayers = (map: FakeMap) => [...map.layers.keys()];

describe('ogm-overview', () => {
  it('draws a box for every record it is given', async () => {
    const { el, map } = await renderOverview();
    el.records = [record('one', { dcat_bbox: CALIFORNIA }), record('two', { dcat_bbox: ICELAND })];
    await el.draw();

    expect(boxLayers(map)).toEqual(['one-location-fill', 'one-location-outline', 'two-location-fill', 'two-location-outline']);
  });

  it('draws the extents it was handed instead of the records’ own', async () => {
    const { el, map } = await renderOverview();
    el.records = [record('one', { dcat_bbox: CALIFORNIA })];
    el.previewers = [new LocationPreviewer(new LocationResource('handed-over', { type: 'Point', coordinates: [0, 0] }))];
    await el.draw();

    expect(boxLayers(map)).toEqual(['handed-over-location-fill', 'handed-over-location-outline']);
  });

  it('takes the last set of boxes off the map before drawing the next', async () => {
    const { el, map } = await renderOverview();
    el.records = [record('one', { dcat_bbox: CALIFORNIA })];
    await el.draw();

    el.records = [record('two', { dcat_bbox: ICELAND })];
    await el.onRecordsChange();

    expect(boxLayers(map)).toEqual(['two-location-fill', 'two-location-outline']);
    expect(map.sources.has('one-location')).toBe(false);
  });

  it('shows the whole world when it has no records to place', async () => {
    const { el, map } = await renderOverview();
    el.records = [];
    await el.draw();

    expect(map.fitBounds.mock.calls[0][0]).toEqual(WORLD);
    expect(map.setProjection).toHaveBeenCalledWith({ type: 'mercator' });
  });

  it('draws a single record on a globe', async () => {
    const { el, map } = await renderOverview();
    el.records = [record('one', { dcat_bbox: CALIFORNIA })];
    await el.draw();

    expect(map.setProjection).toHaveBeenCalledWith({ type: 'globe' });
    expect(map.setProjection.mock.invocationCallOrder[0]).toBeLessThan(map.fitBounds.mock.invocationCallOrder[0]);
  });

  it('draws several records on a flat map', async () => {
    const { el, map } = await renderOverview();
    el.records = [record('one', { dcat_bbox: CALIFORNIA }), record('two', { dcat_bbox: ICELAND })];
    await el.draw();

    expect(map.setProjection).toHaveBeenCalledWith({ type: 'mercator' });
  });

  it('draws a globe when only one of several records says where it is', async () => {
    const { el, map } = await renderOverview();
    el.records = [record('nowhere'), record('two', { dcat_bbox: ICELAND }), record('nowhere-either')];
    await el.draw();

    expect(map.setProjection).toHaveBeenCalledWith({ type: 'globe' });
  });

  it('keeps the globe for a single record too wide to fit on one', async () => {
    const { el, map } = await renderOverview();
    el.records = [record('the-world', { dcat_bbox: THE_WORLD })];
    await el.draw();

    expect(map.setProjection).toHaveBeenCalledWith({ type: 'globe' });
    expect(boxLayers(map)).toEqual(['the-world-location-fill', 'the-world-location-outline']);

    const [bounds] = map.fitBounds.mock.calls[0];
    expect(bounds.getEast() - bounds.getWest()).toEqual(180);
    expect(bounds.getCenter().lng).toEqual(0);
  });

  it('opens no closer than city scale, whatever it was asked to frame', async () => {
    const { el, map } = await renderOverview();
    el.records = [record('a-point', { locn_geometry: 'POINT(-122.17 37.43)' })];
    await el.draw();

    const [, options] = map.fitBounds.mock.calls[0];
    expect(options.maxZoom).toEqual(12);
  });

  // The gap the theme keeps around an overview, which is wider than the one a preview gets: a box
  // drawn against the edge of a map this small reads as running off it.
  it('holds what it frames away from the edge of the map', async () => {
    const { el, map } = await renderOverview();
    el.records = [record('one', { dcat_bbox: CALIFORNIA })];
    await el.draw();

    const [, options] = map.fitBounds.mock.calls[0];
    expect(options.padding).toEqual(el.mapTheme.getStyle().overviewPadding);
    expect(options.padding).toBeGreaterThan(el.mapTheme.getPadding());
  });

  it('points the camera where it was told, rather than at what it drew', async () => {
    const { el, map } = await renderOverview();
    el.records = [record('one', { dcat_bbox: ICELAND })];
    await el.draw();

    el.bounds = CALIFORNIA;
    await el.onBoundsChange();

    expect(boundsToBbox(map.fitBounds.mock.calls.at(-1)![0])).toEqual([-124.41, 32.53, -114.13, 42.01]);

    // Only the view of it changed; what was on the map is still on it, and still where it was
    expect(boxLayers(map)).toEqual(['one-location-fill', 'one-location-outline']);
  });

  // An embedder naming an area has already said what they want on screen, so neither the gap nor the
  // zoom limit an overview of records gets is applied to it
  it('frames a stated camera exactly', async () => {
    const { el, map } = await renderOverview();
    el.bounds = CALIFORNIA;
    await el.draw();

    expect(map.fitBounds.mock.calls.at(-1)![1]).toEqual({ padding: 0 });
  });

  // The round trip: the area a reader asked to search, handed back, is a camera that doesn't move
  it('holds the map where it was when the area it reported is handed back', async () => {
    const { el, map } = await renderOverview();
    const view = map.getBounds();

    el.bounds = boundsToBbox(view);
    await el.draw();

    const [bounds] = map.fitBounds.mock.calls.at(-1)!;
    expect(bounds.getEast() - bounds.getWest()).toEqual(view.getEast() - view.getWest());
    expect([bounds.getSouth(), bounds.getNorth()]).toEqual([view.getSouth(), view.getNorth()]);
  });

  // A globe can't be pointed at every box one might name, so a stated camera is always a flat one
  it('draws a single record on a flat map when the camera was stated', async () => {
    const { el, map } = await renderOverview();
    el.records = [record('one', { dcat_bbox: CALIFORNIA })];
    el.bounds = ICELAND;
    await el.draw();

    expect(map.setProjection).toHaveBeenCalledWith({ type: 'mercator' });
  });

  it('returns to a stated camera when what is drawn changes', async () => {
    const { el, map } = await renderOverview();
    el.bounds = CALIFORNIA;
    el.records = [record('one', { dcat_bbox: ICELAND })];
    await el.draw();

    el.records = [record('two', { dcat_bbox: THE_WORLD })];
    await el.onRecordsChange();

    expect(boundsToBbox(map.fitBounds.mock.calls.at(-1)![0])).toEqual([-124.41, 32.53, -114.13, 42.01]);
  });

  it('goes back to framing what it drew when the camera is withdrawn', async () => {
    const { el, map } = await renderOverview();
    el.records = [record('one', { dcat_bbox: ICELAND })];
    el.bounds = CALIFORNIA;
    await el.draw();

    el.bounds = undefined;
    await el.onBoundsChange();

    const [bounds, options] = map.fitBounds.mock.calls.at(-1)!;
    expect(boundsToBbox(bounds)).toEqual([-24.55, 63.39, -13.49, 66.57]);
    expect(options.maxZoom).toEqual(12);
  });

  // Which is how a page rendered by a server says where its map opens, without any JavaScript
  it('takes a camera from an attribute', async () => {
    const { el, map } = await renderOverview();
    el.setAttribute('bounds', CALIFORNIA);

    expect(el.bounds).toEqual(CALIFORNIA);
    await el.frame();
    expect(boundsToBbox(map.fitBounds.mock.calls.at(-1)![0])).toEqual([-124.41, 32.53, -114.13, 42.01]);
  });

  it('frames what it drew, and says so, when it cannot read the camera it was given', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { el, map } = await renderOverview();
    el.records = [record('one', { dcat_bbox: ICELAND })];
    el.bounds = 'somewhere nice';
    await el.draw();

    expect(consoleWarn).toHaveBeenCalledWith('Could not read bounds:', 'somewhere nice');
    expect(boundsToBbox(map.fitBounds.mock.calls.at(-1)![0])).toEqual([-24.55, 63.39, -13.49, 66.57]);
    consoleWarn.mockRestore();
  });

  it('carries the Web Awesome scope, being usable on its own', async () => {
    const { el } = await renderOverview();

    expect(el.className).toContain('wa-palette-default');
    expect((el.shadowRoot as ShadowRoot).querySelector('link[rel="stylesheet"]')).toBeTruthy();
  });
});

describe('ogm-overview geosearch', () => {
  // An overview of one record's location has nobody to report a search to
  it('offers no search unless it was asked to', async () => {
    const { el, map } = await renderOverview();
    el.onGeosearchChange();

    expect(map.controls).toEqual([]);
  });

  // Top left because the attribution, this map's only other control, is drawn bottom right
  it('puts the control over the top left of the map', async () => {
    const { el, map } = await renderOverview();
    el.geosearch = 'auto';
    el.onGeosearchChange();

    expect(map.controls).toHaveLength(1);
    expect(map.controls[0].position).toEqual('top-left');
    expect(map.controls[0].element.className).toContain('maplibregl-ctrl-geosearch');
  });

  it('starts the control in the mode it was given', async () => {
    const { el, map } = await renderOverview();
    el.geosearch = 'manual';
    el.onGeosearchChange();

    const { element } = map.controls[0];
    expect((element.querySelector('button') as HTMLButtonElement).hidden).toBe(false);
    expect((element.querySelector('label') as HTMLLabelElement).hidden).toBe(true);
  });

  it('hands the control its wording, and passes on a change to it', async () => {
    const { el, map } = await renderOverview();
    el.geosearch = 'auto';
    el.searchHereText = 'Cerca aquí';
    el.searchOnMoveText = 'Cerca quan moc el mapa';
    el.onGeosearchChange();

    const { element } = map.controls[0];
    expect(element.querySelector('label')?.textContent).toEqual('Cerca quan moc el mapa');

    el.searchHereText = 'Search here';
    el.onGeosearchLabelsChange();
    expect(element.querySelector('button')?.textContent).toEqual('Search here');
  });

  // The whole path: the reader moves the map, the control waits for them to stop, and what comes out is
  // the area a query can state - both edges brought back into range, east numerically west of west
  // because the view straddles the antimeridian. See boundsToBbox.
  it('reports where the reader asked to search, in west, south, east, north', async () => {
    const { el, map } = await renderOverview();
    el.geosearch = 'auto';
    el.onGeosearchChange();

    const areas: [number, number, number, number][] = [];
    el.addEventListener('boundsChange', event => areas.push((event as CustomEvent<[number, number, number, number]>).detail));

    vi.useFakeTimers();
    map.fire('moveend', DROVE);
    vi.advanceTimersByTime(800);

    expect(areas).toEqual([[170, -10, -160, 10]]);
  });

  it('reports nothing for a camera it moved itself', async () => {
    const { el, map } = await renderOverview();
    el.geosearch = 'auto';
    el.onGeosearchChange();

    const areas: unknown[] = [];
    el.addEventListener('boundsChange', event => areas.push((event as CustomEvent).detail));

    vi.useFakeTimers();
    map.fire('moveend', {});
    vi.advanceTimersByTime(800);

    expect(areas).toEqual([]);
  });

  it('takes the control back off, and its bindings with it, when the offer is withdrawn', async () => {
    const { el, map } = await renderOverview();
    el.geosearch = 'auto';
    el.onGeosearchChange();

    el.geosearch = undefined;
    el.onGeosearchChange();

    expect(map.controls).toEqual([]);
    expect(map.listeners['moveend']).toEqual([]);
  });
});

// componentDidLoad waits on the palette's stylesheet, which lands in a later task than the one that
// rendered - so there is a window in which the overview can be taken off the page while it is still
// waiting. Nothing may start observing the container after that: whenSized gives up only once the
// container has a box, and a detached one never gets one, so the observer would outlive the component.
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
  const paletteArrives = async (link: HTMLLinkElement, el: Overview) => {
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
