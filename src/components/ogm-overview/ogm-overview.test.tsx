import { describe, it, expect, h, vi, beforeEach, afterEach } from '@stencil/vitest';

// Rendered with Stencil's low-level render rather than @stencil/vitest's `render` wrapper, for the
// same reason ogm-map's tests are: the wrapper re-throws lifecycle errors, and componentDidLoad
// throws here when MapLibre can't get a WebGL context. What's under test is what happens once a map
// exists, so one is handed to the component afterwards.
import { render as stencilRender } from '@stencil/core';

import { WORLD } from '../../lib/geometry';
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
  onRecordsChange: () => Promise<void>;
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

  it('carries the Web Awesome scope, being usable on its own', async () => {
    const { el } = await renderOverview();

    expect(el.className).toContain('wa-palette-default');
    expect((el.shadowRoot as ShadowRoot).querySelector('link[rel="stylesheet"]')).toBeTruthy();
  });
});
