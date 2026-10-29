import { describe, it, expect, h, vi, beforeEach, afterEach } from '@stencil/vitest';
import type { MapGeoJSONFeature } from 'maplibre-gl';

import { render as stencilRender } from '@stencil/core';

import type { LayerState } from '../../lib/layers';
import type { LegendImage } from '../../lib/legend';
import TimeDomain from '../../lib/time';
import TileJsonVectorPreviewer from '../../lib/previewers/tilejson-vector';
import XyzPreviewer from '../../lib/previewers/xyz';
import TileJsonResource from '../../lib/resources/tilejson';
import XyzResource from '../../lib/resources/xyz';

const feature = {
  type: 'Feature',
  id: 'sheet.1',
  source: 'a-preview',
  sourceLayer: undefined,
  geometry: { type: 'Polygon', coordinates: [] },
  properties: { label: 'SB 24' },
} as unknown as MapGeoJSONFeature;

const fakeMap = () => ({ setFeatureState: vi.fn(), remove: vi.fn() });

const fittableMap = () => ({
  cameraForBounds: vi.fn(() => ({ center: [0, 0], zoom: 4 })),
  getCanvas: () => ({ clientWidth: 800, clientHeight: 600 }),
  fitBounds: vi.fn(),
  easeTo: vi.fn(),
  once: vi.fn((_event: string, listener: () => void) => listener()),
  remove: vi.fn(),
});

const bounds = [
  [0, 0],
  [1, 1],
];

const loadingMap = () => {
  const map = {
    styleLoaded: false,
    ...fittableMap(),
    setProjection: vi.fn(() => {
      if (!map.styleLoaded) throw new Error('Style is not done loading.');
    }),
    setMaxPitch: vi.fn(),
    setMinZoom: vi.fn(),
    setStyle: vi.fn(),
  };
  return map;
};

const fakeLayersControl = () => ({ setPressed: vi.fn() });

const drawablePreviewer = () => ({
  projection: 'mercator',
  maxPitch: 30,
  inspectable: true,
  minZoom: undefined as number | undefined,
  onNotice: undefined as ((notice: string | undefined) => void) | undefined,
  onLoading: undefined as ((loading: boolean) => void) | undefined,
  url: 'http://example.com/data.json',
  sourceIds: [] as string[],
  previewLayers: [],
  label: () => 'GeoJSON',
  attach: vi.fn(),
  preview: vi.fn(async () => {}),
  applyLayerState: vi.fn(),
  clearPreview: vi.fn(async () => {}),
  getBounds: vi.fn(async () => bounds),
  declaredBounds: undefined as number[][] | undefined,
  getReportedBounds: vi.fn(async (): Promise<number[][] | undefined> => undefined),
  expandFeatures: vi.fn(async (features: MapGeoJSONFeature[]) => features),
  tileLoaded: vi.fn(),
  absorbTileError: vi.fn(() => false),
});

const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0));

const settleBasemap = () => new Promise<void>(resolve => setTimeout(resolve, 400));

const mapError = (sourceId?: string) => ({ error: new Error('Failed to fetch'), sourceId }) as never;

const raiseMapError = (el: HTMLElement, sourceId?: string) => (el as unknown as { handleMapError: (event: never) => void }).handleMapError(mapError(sourceId));

const notices = (el: HTMLElement) => Array.from((el.shadowRoot as ShadowRoot).querySelectorAll('wa-callout.notice'));
const noticeTexts = (el: HTMLElement) => notices(el).map(callout => callout.textContent ?? '');
const noticeVariants = (el: HTMLElement) => notices(el).map(callout => callout.getAttribute('variant'));
const basemapUrl = (el: HTMLElement) => (el.shadowRoot as ShadowRoot).querySelector('.basemap-url');

const fitTo = (el: HTMLElement, mapBounds: number[][]) => (el as unknown as { fitMapBounds: (bounds: number[][]) => Promise<void> }).fitMapBounds(mapBounds);

const setThemeProperty = (el: HTMLElement, property: string, value: string) => {
  const scope = (el.shadowRoot as ShadowRoot).querySelector('.container') as HTMLElement;
  scope.style.setProperty(property, value);
};

const styleLoads = async (el: HTMLElement, map: ReturnType<typeof loadingMap>) => {
  map.styleLoaded = true;
  Object.assign(el, { mapStyleLoaded: true });
  await (el as unknown as { loadPreview: () => Promise<void> }).loadPreview();
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

const renderMap = async (lightBasemap?: string) => {
  const container = document.createElement('div');
  containers.push(container);
  document.body.appendChild(container);
  await stencilRender(<ogm-map lightBasemap={lightBasemap}></ogm-map>, container);
  const el = container.firstElementChild as HTMLElement & { componentOnReady?: () => Promise<unknown> };
  await el.componentOnReady?.();
  consoleError.mockClear();
  return { container, el };
};

const selection = (detail: MapGeoJSONFeature = feature) => new CustomEvent('featureSelected', { detail, bubbles: true, composed: true });

const selectInOwnPopup = (el: HTMLElement, detail: MapGeoJSONFeature = feature) => {
  const popup = document.createElement('div');
  (el.shadowRoot as ShadowRoot).appendChild(popup);
  popup.dispatchEvent(selection(detail));
};

describe('ogm-map', () => {
  it('highlights a feature selected in its own popup', async () => {
    const { el } = await renderMap();
    const map = fakeMap();
    Object.assign(el, { map });

    selectInOwnPopup(el);

    expect(map.setFeatureState).toHaveBeenCalledWith({ source: 'a-preview', id: 'sheet.1', sourceLayer: undefined }, { selected: true });
  });

  it('leaves a selection made in another map’s popup alone', async () => {
    const { el } = await renderMap();
    const map = fakeMap();
    Object.assign(el, { map });

    document.body.dispatchEvent(selection());

    expect(map.setFeatureState).not.toHaveBeenCalled();
  });

  it('ignores a feature selection before it has a map to draw it on', async () => {
    const { el } = await renderMap();

    selectInOwnPopup(el);

    expect(consoleError).not.toHaveBeenCalled();
  });

  describe('for a tileset whose features have no ids', () => {
    const temple = {
      ...feature,
      id: undefined,
      source: 'a-preview-tilejson',
      sourceLayer: 'cultural_places',
      properties: { id: 'way/23630366', name: 'Wat Pho' },
    } as unknown as MapGeoJSONFeature;

    const tilesetPreviewer = () => {
      const previewer = new TileJsonVectorPreviewer(new TileJsonResource('a-preview', 'https://example.com/tilejson.json'));
      vi.spyOn(previewer, 'matchSelection').mockImplementation(() => undefined);
      return previewer;
    };

    it('has the preview draw the selection by what the feature says', async () => {
      const { el } = await renderMap();
      const map = fakeMap();
      const previewer = tilesetPreviewer();
      Object.assign(el, { map, previewer });

      selectInOwnPopup(el, temple);

      expect(previewer.matchSelection).toHaveBeenCalledWith(temple);
      expect(map.setFeatureState).not.toHaveBeenCalled();
    });

    it('has the preview stop drawing it when the selection ends', async () => {
      const { el } = await renderMap();
      const previewer = tilesetPreviewer();
      Object.assign(el, { map: fakeMap(), previewer });

      selectInOwnPopup(el, temple);
      (el as unknown as { clearFeatureSelection: () => void }).clearFeatureSelection();

      expect(previewer.matchSelection).toHaveBeenLastCalledWith(undefined);
    });

    it('draws nothing for a hover', async () => {
      const { el } = await renderMap();
      const map = { ...fakeMap(), queryRenderedFeatures: vi.fn(() => [temple]), getCanvas: () => ({ style: {} }) };
      const previewer = tilesetPreviewer();
      Object.assign(el, { map, previewer });

      (el as unknown as { handleHover: (event: unknown) => void }).handleHover({ point: { x: 1, y: 1 } });
      (el as unknown as { clearHoveredFeature: () => void }).clearHoveredFeature();

      expect(map.setFeatureState).not.toHaveBeenCalled();
      expect(previewer.matchSelection).not.toHaveBeenCalled();
    });
  });

  it('establishes the Web Awesome scope on an element inside its own shadow root', async () => {
    const { el } = await renderMap();
    const root = el.shadowRoot as ShadowRoot;

    const scope = root.querySelector('.container') as HTMLElement;

    expect(scope.classList.contains('wa-palette-default')).toBe(true);
    expect(scope.querySelector('#map')).toBeTruthy();
  });

  it('builds its theme with the caller’s own basemaps', async () => {
    const container = document.createElement('div');
    containers.push(container);
    document.body.appendChild(container);
    await stencilRender(<ogm-map darkBasemap="https://example.com/dark.json" lightBasemap="https://example.com/light.json"></ogm-map>, container);
    const el = container.firstElementChild as HTMLElement & {
      componentOnReady?: () => Promise<unknown>;
      mapTheme?: { darkBasemap?: string; lightBasemap?: string };
    };
    await el.componentOnReady?.();
    consoleError.mockClear();

    expect(el.mapTheme?.darkBasemap).toBe('https://example.com/dark.json');
    expect(el.mapTheme?.lightBasemap).toBe('https://example.com/light.json');
  });

  it('keeps the theme’s gap between the bounds it fits and the edge of the map', async () => {
    const { el } = await renderMap();
    setThemeProperty(el, '--ogm-padding', '50');
    Object.assign(el, { map: fittableMap() });

    await fitTo(el, bounds);

    expect((el as unknown as { map: ReturnType<typeof fittableMap> }).map.fitBounds).toHaveBeenCalledWith(bounds, { padding: 50, animate: false });
  });

  it('leaves the room the sidebar takes out of what it asks for', async () => {
    const { el } = await renderMap();
    setThemeProperty(el, '--ogm-padding', '50');
    Object.assign(el, { map: fittableMap(), padding: 400 });

    await fitTo(el, bounds);

    expect((el as unknown as { map: ReturnType<typeof fittableMap> }).map.fitBounds).toHaveBeenCalledWith(bounds, { padding: 50, animate: false });
  });

  it('holds a preview handed to it before its style has loaded, then draws it', async () => {
    const { el } = await renderMap();
    const map = loadingMap();
    const previewer = drawablePreviewer();
    const reported = vi.fn();
    el.addEventListener('previewError', reported);
    Object.assign(el, { map, layersControl: fakeLayersControl() });

    Object.assign(el, { previewer });
    await settle();

    expect(map.setProjection).not.toHaveBeenCalled();
    expect(previewer.preview).not.toHaveBeenCalled();
    expect(reported).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();

    await styleLoads(el, map);

    expect(previewer.preview).toHaveBeenCalled();
    expect(map.fitBounds).toHaveBeenCalled();
    expect(reported).not.toHaveBeenCalled();
  });

  it('draws a preview that needs a flat map on one', async () => {
    const { el } = await renderMap();
    const map = loadingMap();
    Object.assign(el, { map, layersControl: fakeLayersControl(), previewer: drawablePreviewer() });

    await styleLoads(el, map);

    expect(map.setProjection).toHaveBeenCalledWith({ type: 'mercator' });
    expect(map.setMaxPitch).toHaveBeenCalledWith(30);
  });

  describe('while tiles of the preview are arriving', () => {
    const idlingMap = (el: HTMLElement) => ({
      triggerRepaint: vi.fn(() => setTimeout(() => (el as unknown as { settleTileLoading: () => void }).settleTileLoading())),
      remove: vi.fn(),
    });

    const tileLoading = async () => {
      const { el } = await renderMap();
      const previewer = drawablePreviewer();
      previewer.sourceIds = ['a-preview'];
      Object.assign(el, { previewer, map: idlingMap(el), mapStyleLoaded: true });

      const said: string[] = [];
      el.addEventListener('mapLoading', () => said.push('start'));
      el.addEventListener('mapIdle', () => said.push('stop'));
      const reported = vi.fn();
      el.addEventListener('previewError', reported);

      const map = el as unknown as {
        handleSourceDataLoading: (event: { sourceId: string }) => void;
        settleTileLoading: () => void;
        tilesLoading: boolean;
      };
      return { el, map, said, reported };
    };

    it('says the map is loading, and says so once for the batch rather than once per tile', async () => {
      const { map, said } = await tileLoading();

      map.handleSourceDataLoading({ sourceId: 'a-preview' });
      map.handleSourceDataLoading({ sourceId: 'a-preview' });

      expect(said).toEqual(['start']);
    });

    it('says it is done once the map has nothing left to draw', async () => {
      const { map, said } = await tileLoading();

      map.handleSourceDataLoading({ sourceId: 'a-preview' });
      map.settleTileLoading();

      expect(said).toEqual(['start', 'stop']);
      expect(map.tilesLoading).toEqual(false);
    });

    it('stays quiet about a basemap filling in under a preview that is already drawn', async () => {
      const { map, said } = await tileLoading();

      map.handleSourceDataLoading({ sourceId: 'carto' });

      expect(said).toEqual([]);
    });

    it('says nothing twice when the map settles again with nothing outstanding', async () => {
      const { map, said } = await tileLoading();

      map.handleSourceDataLoading({ sourceId: 'a-preview' });
      map.settleTileLoading();
      map.settleTileLoading();

      expect(said).toEqual(['start', 'stop']);
    });

    it('settles on the way out, so the count it was added to does not keep the spinner up', async () => {
      const { el, map, said } = await tileLoading();
      map.handleSourceDataLoading({ sourceId: 'a-preview' });

      (el as unknown as { disconnectedCallback: () => void }).disconnectedCallback();

      expect(said).toEqual(['start', 'stop']);
    });

    it('says it is done once the last tile it was waiting on has failed', async () => {
      const { el, map, said } = await tileLoading();

      map.handleSourceDataLoading({ sourceId: 'a-preview' });
      raiseMapError(el, 'a-preview');
      await settle();

      expect(said).toEqual(['start', 'stop']);
    });

    it('says so again when the next batch fails, though only the first failure is reported', async () => {
      const { el, map, said, reported } = await tileLoading();

      map.handleSourceDataLoading({ sourceId: 'a-preview' });
      raiseMapError(el, 'a-preview');
      await settle();
      map.handleSourceDataLoading({ sourceId: 'a-preview' });
      raiseMapError(el, 'a-preview');
      await settle();

      expect(reported).toHaveBeenCalledTimes(1);
      expect(said).toEqual(['start', 'stop', 'start', 'stop']);
    });

    it('says it is done when the tile that failed last was the basemap’s', async () => {
      const { el, map, said, reported } = await tileLoading();

      map.handleSourceDataLoading({ sourceId: 'a-preview' });
      raiseMapError(el, 'carto');
      await settle();

      expect(said).toEqual(['start', 'stop']);
      expect(reported).not.toHaveBeenCalled();
    });

    it('says nothing about a failure when it had not said it was loading', async () => {
      const { el, said } = await tileLoading();

      raiseMapError(el, 'a-preview');
      await settle();

      expect(said).toEqual([]);
    });

    describe('when one of them fails', () => {
      const tile = { tileID: { canonical: { z: 3, x: 0, y: 0 } } };
      const tileArrives = (el: HTMLElement) => (el as unknown as { handleSourceData: (event: unknown) => void }).handleSourceData({ sourceId: 'a-preview', tile });
      const tileFails = (el: HTMLElement) =>
        (el as unknown as { handleMapError: (event: unknown) => void }).handleMapError({
          error: Object.assign(new Error('Internal Server Error'), { status: 500 }),
          sourceId: 'a-preview',
          tile,
        });

      let warn: ReturnType<typeof vi.spyOn>;

      const failing = async () => {
        const loading = await tileLoading();
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        return { ...loading, warn };
      };

      afterEach(() => warn?.mockRestore());

      it('keeps a preview that has already drawn, and says so only in the console', async () => {
        const { el, reported, warn } = await failing();

        tileArrives(el);
        tileFails(el);
        tileFails(el);
        await settle();

        expect(reported).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledTimes(2);
        expect(String(warn.mock.calls[0][0])).toContain('http://example.com/data.json');
      });

      it('still says the batch is done', async () => {
        const { el, map, said } = await failing();

        tileArrives(el);
        map.handleSourceDataLoading({ sourceId: 'a-preview' });
        tileFails(el);
        await settle();

        expect(said).toEqual(['start', 'stop']);
      });

      it('still reports one that fails before anything has drawn', async () => {
        const { el, reported, warn } = await failing();

        tileFails(el);
        await settle();

        expect(reported).toHaveBeenCalledTimes(1);
        expect(reported.mock.calls[0][0].detail.message).toContain('HTTP 500');
        expect(warn).not.toHaveBeenCalled();
      });

      it('still reports a failure of the whole source after drawing', async () => {
        const { el, reported } = await failing();

        tileArrives(el);
        raiseMapError(el, 'a-preview');
        await settle();

        expect(reported).toHaveBeenCalledTimes(1);
      });
    });
  });

  it('holds the map to a floor the preview asked for once it has drawn', async () => {
    const { el } = await renderMap();
    const map = loadingMap();
    const previewer = drawablePreviewer();
    previewer.preview = vi.fn(async () => {
      previewer.minZoom = 9;
    });
    Object.assign(el, { map, layersControl: fakeLayersControl(), previewer });

    await styleLoads(el, map);

    expect(map.setMinZoom).toHaveBeenLastCalledWith(9);
  });

  it('puts its own floor back for a preview that asks for none', async () => {
    const { el } = await renderMap();
    const map = loadingMap();
    Object.assign(el, { map, layersControl: fakeLayersControl(), previewer: drawablePreviewer() });

    await styleLoads(el, map);

    expect(map.setMinZoom).toHaveBeenLastCalledWith(1);
  });

  it('lets the preview fill in what its drawn features do not carry', async () => {
    const { el } = await renderMap();
    const previewer = drawablePreviewer();
    const expanded = { ...feature, properties: { label: 'SB 24', everything: 'else' } } as unknown as MapGeoJSONFeature;
    previewer.expandFeatures = vi.fn(async () => [expanded]);
    Object.assign(el, {
      map: { queryRenderedFeatures: vi.fn(() => [feature]), remove: vi.fn() },
      previewer,
    });

    const inspected = await (el as unknown as { handleInspection: (point: unknown) => Promise<MapGeoJSONFeature[]> }).handleInspection({ x: 1, y: 1 });

    expect(previewer.expandFeatures).toHaveBeenCalledWith([feature]);
    expect(inspected).toEqual([expanded]);
  });

  describe('over a stack of editions sharing one label', () => {
    const edition = (id: number, layer: { id: string; type: string }) =>
      ({ ...feature, id, layer: { ...layer, source: 'a-preview' }, properties: { label: `Bright Angel ${id}` } }) as unknown as MapGeoJSONFeature;
    const label = (id: number) => edition(id, { id: 'a-preview-polygon-labels', type: 'symbol' });
    const fill = (id: number) => edition(id, { id: 'a-preview-polygons', type: 'fill' });

    const besideLabel = () => [fill(19), fill(12), fill(6)];
    const onLabel = () => [label(6), ...besideLabel()];

    it('opens at the edition drawn on top, whether the click lands on the label or beside it', async () => {
      const { el } = await renderMap();
      const queryRenderedFeatures = vi.fn();
      Object.assign(el, { map: { queryRenderedFeatures, remove: vi.fn() }, previewer: drawablePreviewer() });
      const inspect = (answer: MapGeoJSONFeature[]) => {
        queryRenderedFeatures.mockReturnValueOnce(answer);
        return (el as unknown as { handleInspection: (point: unknown) => Promise<MapGeoJSONFeature[]> }).handleInspection({ x: 1, y: 1 });
      };

      const onIt = await inspect(onLabel());
      const besideIt = await inspect(besideLabel());

      expect(onIt.map(sheet => sheet.id)).toEqual([19, 12, 6]);
      expect(besideIt.map(sheet => sheet.id)).toEqual([19, 12, 6]);
    });

    it('lights up the edition a click would open at, over the label as much as beside it', async () => {
      const { el } = await renderMap();
      const map = { queryRenderedFeatures: vi.fn(onLabel), setFeatureState: vi.fn(), getCanvas: () => ({ style: {} }), remove: vi.fn() };
      Object.assign(el, { map, previewer: drawablePreviewer() });

      (el as unknown as { handleHover: (event: unknown) => void }).handleHover({ point: { x: 1, y: 1 } });

      expect(map.setFeatureState).toHaveBeenCalledTimes(1);
      expect(map.setFeatureState).toHaveBeenCalledWith({ source: 'a-preview', id: 19, sourceLayer: undefined }, { hover: true });
    });
  });

  it('shows what a preview has to say about the view it was asked to draw in', async () => {
    const { el } = await renderMap();
    const map = loadingMap();
    const previewer = drawablePreviewer();
    Object.assign(el, { map, layersControl: fakeLayersControl(), previewer });

    await styleLoads(el, map);
    previewer.onNotice?.('Zoom in to see this layer’s features.');
    await settle();

    expect(el.shadowRoot?.querySelector('wa-callout.notice')?.textContent).toContain('Zoom in');
    expect(noticeVariants(el)).toEqual(['brand']);
  });

  describe('when the record’s bounding box misses the data altogether', () => {
    const archive = [
      [-123.532115, 36.893111],
      [-121.208298, 38.864317],
    ];
    let consoleWarn: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => consoleWarn.mockRestore());

    const drawWith = async (declared: number[][] | undefined, reported: () => Promise<number[][] | undefined>) => {
      const { el } = await renderMap();
      const map = loadingMap();
      const previewer = { ...drawablePreviewer(), declaredBounds: declared, getBounds: vi.fn(async () => declared ?? (await reported())), getReportedBounds: vi.fn(reported) };
      const reportedError = vi.fn();
      el.addEventListener('previewError', reportedError);
      Object.assign(el, { map, layersControl: fakeLayersControl(), previewer });

      await styleLoads(el, map);
      await settle();
      return { el, map, previewer, reportedError };
    };

    it('frames the map on the data instead', async () => {
      const { map } = await drawWith(bounds, async () => archive);

      expect(map.fitBounds).toHaveBeenCalledTimes(2);
      expect(map.fitBounds).toHaveBeenLastCalledWith(archive, expect.anything());
    });

    it('says so over the map, as a warning', async () => {
      const { el, reportedError } = await drawWith(bounds, async () => archive);

      expect(noticeTexts(el)).toEqual([expect.stringContaining('bounding box doesn’t overlap the data')]);
      expect(noticeVariants(el)).toEqual(['warning']);
      expect(reportedError).not.toHaveBeenCalled();
    });

    it('puts both boxes in the console, for whoever has the record to fix', async () => {
      await drawWith(bounds, async () => archive);

      expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining('(0, 0, 1, 1)'));
      expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining('(-123.532115, 36.893111, -121.208298, 38.864317)'));
    });

    it('keeps it apart from what the preview has to say about the view', async () => {
      const { el, previewer } = await drawWith(bounds, async () => archive);
      previewer.onNotice?.('Zoom in to see this layer’s features.');
      await settle();

      expect(noticeVariants(el)).toEqual(['brand', 'warning']);
      previewer.onNotice?.(undefined);
      await settle();
      expect(noticeVariants(el)).toEqual(['warning']);
    });

    it('takes the notice down for the next preview', async () => {
      const { el, map } = await drawWith(bounds, async () => archive);
      Object.assign(el, { previewer: drawablePreviewer() });
      await settle();

      expect(map.fitBounds).toHaveBeenLastCalledWith(bounds, expect.anything());
      expect(noticeTexts(el)).toEqual([]);
    });

    it('keeps to the record’s box when it overlaps the data at all', async () => {
      const { el, map } = await drawWith(bounds, async () => [
        [0.9, 0.9],
        [5, 5],
      ]);

      expect(map.fitBounds).toHaveBeenCalledTimes(1);
      expect(map.fitBounds).toHaveBeenCalledWith(bounds, expect.anything());
      expect(noticeTexts(el)).toEqual([]);
    });

    it('asks nothing of a preview whose record gave no box, which is framed on the data already', async () => {
      const { el, map, previewer } = await drawWith(undefined, async () => archive);

      expect(previewer.getReportedBounds).not.toHaveBeenCalled();
      expect(map.fitBounds).toHaveBeenCalledTimes(1);
      expect(noticeTexts(el)).toEqual([]);
    });

    it('keeps to the record’s box when the data has no extent to give', async () => {
      const { el, map } = await drawWith(bounds, async () => undefined);

      expect(map.fitBounds).toHaveBeenCalledTimes(1);
      expect(noticeTexts(el)).toEqual([]);
    });

    it('keeps to the record’s box, and raises nothing, when the data’s extent can’t be read', async () => {
      const { el, map, reportedError } = await drawWith(bounds, async () => {
        throw new TypeError('Failed to fetch');
      });

      expect(map.fitBounds).toHaveBeenCalledTimes(1);
      expect(noticeTexts(el)).toEqual([]);
      expect(reportedError).not.toHaveBeenCalled();
    });

    it('leaves a map that has moved on to another preview where it is', async () => {
      const { el } = await renderMap();
      const map = loadingMap();
      let answer: (bounds: number[][]) => void = () => {};
      const previewer = { ...drawablePreviewer(), declaredBounds: bounds, getReportedBounds: vi.fn(() => new Promise<number[][]>(resolve => (answer = resolve))) };
      Object.assign(el, { map, layersControl: fakeLayersControl(), previewer });

      const loading = styleLoads(el, map);
      await settle();
      Object.assign(el, { previewer: drawablePreviewer() });
      await settle();

      answer(archive);
      await loading;

      expect(map.fitBounds).not.toHaveBeenCalledWith(archive, expect.anything());
      expect(noticeTexts(el)).toEqual([]);
    });
  });

  describe('while a preview that draws itself is still drawing', () => {
    const drawingPreview = async () => {
      const { el } = await renderMap();
      const map = loadingMap();
      const previewer = drawablePreviewer();
      Object.assign(el, { map, layersControl: fakeLayersControl(), previewer });
      await styleLoads(el, map);

      const said: string[] = [];
      el.addEventListener('mapLoading', () => said.push('start'));
      el.addEventListener('mapIdle', () => said.push('stop'));
      return { el, map, previewer, said };
    };

    it('says the map is loading until the preview says it is done', async () => {
      const { previewer, said } = await drawingPreview();

      previewer.onLoading?.(true);
      expect(said).toEqual(['start']);

      previewer.onLoading?.(false);
      expect(said).toEqual(['start', 'stop']);
    });

    it('says each once, however often the preview repeats itself', async () => {
      const { previewer, said } = await drawingPreview();

      previewer.onLoading?.(true);
      previewer.onLoading?.(true);
      previewer.onLoading?.(false);
      previewer.onLoading?.(false);

      expect(said).toEqual(['start', 'stop']);
    });

    it('settles a wait the last preview left unfinished when the next one loads, and stops listening to it', async () => {
      const { el, map, previewer, said } = await drawingPreview();
      previewer.onLoading?.(true);

      Object.assign(el, { previewer: drawablePreviewer() });
      await styleLoads(el, map);
      previewer.onLoading?.(true);

      expect(said.filter(event => event === 'start').length).toEqual(said.filter(event => event === 'stop').length);
    });

    it('settles on the way out, so the count it was added to does not keep the spinner up', async () => {
      const { el, previewer, said } = await drawingPreview();
      previewer.onLoading?.(true);

      (el as unknown as { disconnectedCallback: () => void }).disconnectedCallback();

      expect(said).toEqual(['start', 'stop']);
    });
  });

  describe('with a layer whose service publishes a picture of its key', () => {
    const pictured = (legendImages: LegendImage[]) => ({
      ...drawablePreviewer(),
      previewLayers: [{ id: 'roads', title: 'Roads', defaultOpacity: 1, styleLayers: [{ id: 'roads', type: 'raster' }], legendImages }],
    });

    const legend = (el: HTMLElement) => (el.shadowRoot as ShadowRoot).querySelector<HTMLElement & { zoom?: number }>('ogm-legend');

    it('shows a legend for it', async () => {
      const { el } = await renderMap();
      const map = loadingMap();
      Object.assign(el, { map, layersControl: fakeLayersControl(), previewer: pictured([{ url: 'https://example.org/legend/roads.png' }]) });

      await styleLoads(el, map);
      await settle();

      expect(legend(el)).not.toBeNull();
    });

    it('shows a picture limited to some scales only once the map is zoomed to them', async () => {
      const { el } = await renderMap();
      const map = loadingMap();
      const detail = { url: 'https://example.org/legend/detail.png', maxScaleDenominator: 1_000_000 };
      Object.assign(el, { map, layersControl: fakeLayersControl(), previewer: pictured([detail]), zoom: 3 });

      await styleLoads(el, map);
      await settle();
      expect(legend(el)).toBeNull();

      Object.assign(el, { zoom: 12 });
      await settle();
      expect(legend(el)?.zoom).toEqual(12);
    });

    it('keeps a legend the reader folded away folded when it is drawn again', async () => {
      const { el } = await renderMap();
      const map = loadingMap();
      Object.assign(el, { map, layersControl: fakeLayersControl(), previewer: pictured([{ url: 'https://example.org/legend/roads.png' }]) });
      await styleLoads(el, map);
      await settle();

      legend(el)?.dispatchEvent(new CustomEvent('legendToggle', { detail: false, bubbles: true, composed: true }));
      await styleLoads(el, map);
      await settle();

      expect((legend(el) as (HTMLElement & { open?: boolean }) | null)?.open).toBe(false);
    });
  });

  describe('with a layer that can be drawn at more than one time', () => {
    const timed = (values: string[]) => ({
      ...drawablePreviewer(),
      loadTimeDomain: vi.fn(),
      previewLayers: [
        {
          id: 'modis',
          title: 'Corrected Reflectance',
          defaultOpacity: 1,
          styleLayers: [{ id: 'modis', type: 'raster' }],
          defaultTime: '2026-10-01',
          timeDomain: TimeDomain.parse(values),
        },
      ],
    });

    const control = (el: HTMLElement) => (el.shadowRoot as ShadowRoot).querySelector('ogm-time');

    const drawn = async (previewer: ReturnType<typeof timed>) => {
      const { el } = await renderMap();
      const map = loadingMap();
      Object.assign(el, { map, layersControl: fakeLayersControl(), previewer });
      await styleLoads(el, map);
      await settle();
      return el;
    };

    it('shows a time control for it', async () => {
      const el = await drawn(timed(['2026-09-01/2026-10-01/P1D']));
      expect(control(el)).not.toBeNull();
    });

    it('shows none for a layer published at a single time', async () => {
      const el = await drawn(timed(['2026-10-01']));
      expect(control(el)).toBeNull();
    });

    it('draws the time the reader picks', async () => {
      const previewer = timed(['2026-09-01/2026-10-01/P1D']);
      const el = await drawn(previewer);

      control(el)?.dispatchEvent(new CustomEvent('layerTimeChange', { detail: { id: 'modis', time: '2026-09-30' }, bubbles: true, composed: true }));
      await settle();

      const states = previewer.applyLayerState.mock.lastCall?.[0] as ReadonlyMap<string, LayerState>;
      expect(states.get('modis')?.time).toEqual('2026-09-30');
      expect((control(el) as (HTMLElement & { layers?: { time?: string }[] }) | null)?.layers?.[0].time).toEqual('2026-09-30');
    });

    it('asks the preview for every time the layer has once the reader starts using the control', async () => {
      const previewer = timed(['2026-09-01/2026-10-01/P1D']);
      const el = await drawn(previewer);

      control(el)?.dispatchEvent(new CustomEvent('layerTimeDomainRequest', { detail: { id: 'modis' }, bubbles: true, composed: true }));

      expect(previewer.loadTimeDomain).toHaveBeenCalledWith('modis');
    });
  });

  it('draws on an empty basemap when the real one never arrives, and names it', async () => {
    const { el } = await renderMap('https://example.com/light.json');
    const map = loadingMap();
    const previewer = drawablePreviewer();
    const reported = vi.fn();
    el.addEventListener('previewError', reported);
    Object.assign(el, { map, layersControl: fakeLayersControl(), previewer });

    raiseMapError(el);
    await settleBasemap();

    expect(map.setStyle).toHaveBeenCalledWith(expect.objectContaining({ version: 8, sources: {} }));

    expect(noticeVariants(el)).toEqual(['warning']);
    expect(reported).not.toHaveBeenCalled();

    expect(basemapUrl(el)?.textContent).toBe('https://example.com/light.json');
    expect(basemapUrl(el)?.getAttribute('title')).toBe('https://example.com/light.json');
  });

  it('leaves a failed basemap alone once its map has been taken off the page', async () => {
    const { container, el } = await renderMap();
    const map = loadingMap();
    Object.assign(el, { map, layersControl: fakeLayersControl(), previewer: drawablePreviewer() });

    raiseMapError(el);
    container.removeChild(el);
    await settleBasemap();

    expect(map.setStyle).not.toHaveBeenCalled();
  });

  it('keeps a basemap that arrives after something of its own has failed', async () => {
    const { el } = await renderMap();
    const map = loadingMap();
    Object.assign(el, { map, layersControl: fakeLayersControl(), previewer: drawablePreviewer() });

    raiseMapError(el);
    await styleLoads(el, map);
    await settleBasemap();

    expect(map.setStyle).not.toHaveBeenCalled();
    expect(noticeTexts(el)).toEqual([]);
  });

  it('says nothing when a basemap that came up loses tiles', async () => {
    const { el } = await renderMap('https://example.com/light.json');
    const map = loadingMap();
    const previewer = drawablePreviewer();
    const reported = vi.fn();
    el.addEventListener('previewError', reported);
    Object.assign(el, { map, layersControl: fakeLayersControl(), previewer });

    await styleLoads(el, map);
    raiseMapError(el, 'carto');
    await settle();

    expect(noticeTexts(el)).toEqual([]);
    expect(reported).not.toHaveBeenCalled();
    expect(map.setStyle).not.toHaveBeenCalled();
  });

  it('tells its two kinds of notice apart when both are up', async () => {
    const { el } = await renderMap();
    const map = loadingMap();
    const previewer = drawablePreviewer();
    Object.assign(el, { map, layersControl: fakeLayersControl(), previewer });

    raiseMapError(el);
    await settleBasemap();
    await styleLoads(el, map);
    previewer.onNotice?.('Zoom in to see this layer’s features.');
    await settle();

    expect(noticeTexts(el)[0]).toContain('Zoom in');
    expect(noticeTexts(el)[1]).toContain('basemap');
    expect(noticeVariants(el)).toEqual(['brand', 'warning']);
  });

  it('still reports a failure of one of the preview’s own sources', async () => {
    const { el } = await renderMap();
    const map = loadingMap();
    const previewer = { ...drawablePreviewer(), sourceIds: ['a-preview'] };
    const reported = vi.fn();
    el.addEventListener('previewError', reported);
    Object.assign(el, { map, layersControl: fakeLayersControl(), previewer });

    await styleLoads(el, map);
    raiseMapError(el, 'a-preview');
    await settle();

    expect(reported).toHaveBeenCalled();
    expect(noticeTexts(el)).toEqual([]);
  });

  describe('over an XYZ service that stops short of where the reader zooms to', () => {
    const TEMPLATE = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GHRSST_L4_MUR_Sea_Surface_Temperature/default/default/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png';
    const SOURCE = 'ghrsst-xyz';

    const tileMap = () => {
      const sources = new Map<string, Record<string, unknown>>();
      const layers = new Map<string, unknown>();
      return {
        sources,
        getSource: (id: string) => sources.get(id),
        addSource: (id: string, spec: Record<string, unknown>) => sources.set(id, { ...spec }),
        getLayer: (id: string) => layers.get(id),
        addLayer: (layer: { id: string }) => layers.set(layer.id, layer),
        _update: vi.fn(),
        remove: vi.fn(),
      };
    };

    const tile = (z: number) => ({ tileID: { canonical: { z, x: 0, y: 0 } } });

    const handlers = (el: HTMLElement) =>
      el as unknown as {
        handleSourceData: (event: unknown) => void;
        handleMapError: (event: unknown) => void;
      };

    const tileArrives = (el: HTMLElement, z: number) => handlers(el).handleSourceData({ sourceId: SOURCE, tile: tile(z) });
    const tileFails = (el: HTMLElement, z: number) =>
      handlers(el).handleMapError({ error: Object.assign(new Error('Bad Request'), { status: 400 }), sourceId: SOURCE, tile: tile(z) });

    const xyzMap = async () => {
      const { el } = await renderMap();
      const map = tileMap();
      const previewer = new XyzPreviewer(new XyzResource('ghrsst', TEMPLATE)).attach(map as never, { opacity: 0.8 } as never);
      await previewer.preview();

      const reported = vi.fn();
      el.addEventListener('previewError', reported);
      Object.assign(el, { map, previewer });
      Object.assign(el, { mapStyleLoaded: true });
      return { el, map, reported };
    };

    it('keeps the preview up, stretching the deepest tiles it has', async () => {
      const { el, map, reported } = await xyzMap();

      tileArrives(el, 7);
      tileFails(el, 8);
      await settle();

      expect(reported).not.toHaveBeenCalled();
      expect(map.sources.get(SOURCE)?.maxzoom).toEqual(7);
    });

    it('still reports a first tile that fails', async () => {
      const { el, reported } = await xyzMap();

      tileFails(el, 3);
      await settle();

      expect(reported).toHaveBeenCalledTimes(1);
      expect(reported.mock.calls[0][0].detail.message).toContain('HTTP 400');
    });

    it('keeps the preview up past a tile that fails at a zoom that has drawn', async () => {
      const { el, map, reported } = await xyzMap();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      tileArrives(el, 7);
      tileFails(el, 7);
      await settle();

      expect(reported).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(map.sources.get(SOURCE)?.maxzoom).toBeUndefined();
      warn.mockRestore();
    });
  });

  it('ignores a feature selection after it has been removed from the DOM', async () => {
    const { container, el } = await renderMap();
    container.removeChild(el);

    selectInOwnPopup(el);

    expect(consoleError).not.toHaveBeenCalled();
  });

  it('holds cooperative gestures on by default', async () => {
    const { el } = await renderMap();
    expect((el as unknown as { cooperativeGestures: boolean }).cooperativeGestures).toBe(true);
  });

  it('answers a wheel or a single touch right away only once turned off', async () => {
    const { el } = await renderMap();
    const map = { cooperativeGestures: { enable: vi.fn(), disable: vi.fn() }, remove: vi.fn() };
    Object.assign(el, { map });
    const withCooperativeGestures = el as unknown as { cooperativeGestures: boolean; onCooperativeGesturesChange: () => void };

    withCooperativeGestures.cooperativeGestures = false;
    withCooperativeGestures.onCooperativeGesturesChange();

    expect(map.cooperativeGestures.disable).toHaveBeenCalled();
    expect(map.cooperativeGestures.enable).not.toHaveBeenCalled();

    map.cooperativeGestures.disable.mockClear();
    withCooperativeGestures.cooperativeGestures = true;
    withCooperativeGestures.onCooperativeGesturesChange();

    expect(map.cooperativeGestures.enable).toHaveBeenCalled();
    expect(map.cooperativeGestures.disable).not.toHaveBeenCalled();
  });
});
