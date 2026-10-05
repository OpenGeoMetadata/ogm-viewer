import { describe, it, expect, h, vi, beforeEach, afterEach } from '@stencil/vitest';
import type { MapGeoJSONFeature } from 'maplibre-gl';

// Render with Stencil's low-level render rather than @stencil/vitest's `render` wrapper, for the same
// reason ogm-preview's tests do: the wrapper re-throws whatever a lifecycle method leaves behind.
// componentDidLoad never gets as far as a map here - happy-dom lays nothing out, so the container
// never has the box whenSized waits for. That leaves the component mounted and listening with no map
// of its own, which is the state a freshly mounted <ogm-map> is in for real until it has been shown,
// and the state a selection used to crash it in. What needs one is handed a fake afterwards.
import { render as stencilRender } from '@stencil/core';

import type { LayerState } from '../../lib/layers';
import type { LegendImage } from '../../lib/legend';
import TimeDomain from '../../lib/time';
import XyzPreviewer from '../../lib/previewers/xyz';
import XyzResource from '../../lib/resources/xyz';

const feature = {
  type: 'Feature',
  id: 'sheet.1',
  source: 'a-preview',
  sourceLayer: undefined,
  geometry: { type: 'Polygon', coordinates: [] },
  properties: { label: 'SB 24' },
} as unknown as MapGeoJSONFeature;

// Enough of a MapLibre map for a selection to be drawn on, and to be taken down afterwards
const fakeMap = () => ({ setFeatureState: vi.fn(), remove: vi.fn() });

// Enough of one to fit bounds on: it can work out a camera for them, it can say how big its canvas is
// - which is what decides how much of a gap it can spare - it can be moved, and it reports the move
// as having finished, which is what fitMapBounds waits for before resolving.
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

// Enough of one to draw a whole preview onto: it can be constrained to what the preview needs and
// fitted to it. Refuses to be written to until its style document has loaded, the way every one of
// MapLibre's own writers does - see Style#_checkLoaded.
const loadingMap = () => {
  const map = {
    styleLoaded: false,
    ...fittableMap(),
    setProjection: vi.fn(() => {
      if (!map.styleLoaded) throw new Error('Style is not done loading.');
    }),
    setMaxPitch: vi.fn(),
    setMinZoom: vi.fn(),
    // What a basemap that never arrived is replaced with; see fallBackToEmptyBasemap
    setStyle: vi.fn(),
  };
  return map;
};

// Built by addControls, so a map that never got a WebGL context has none of it
const fakeLayersControl = () => ({ setPressed: vi.fn() });

// Enough of a previewer to be drawn: it takes the map and the colors it draws with, draws, and says
// where it should be looked at. Flat and shallow, like the two previews that paint their own WebGL.
const drawablePreviewer = () => ({
  projection: 'mercator',
  maxPitch: 30,
  inspectable: true,
  minZoom: undefined as number | undefined,
  onNotice: undefined as ((notice: string | undefined) => void) | undefined,
  url: 'http://example.com/data.json',
  sourceIds: [] as string[],
  previewLayers: [],
  label: () => 'GeoJSON',
  attach: vi.fn(),
  preview: vi.fn(async () => {}),
  applyLayerState: vi.fn(),
  clearPreview: vi.fn(async () => {}),
  getBounds: vi.fn(async () => bounds),
  expandFeatures: vi.fn(async (features: MapGeoJSONFeature[]) => features),
  tileLoaded: vi.fn(),
  absorbTileError: vi.fn(() => false),
});

// Stencil doesn't await a watcher, so let what the previewer's own started finish
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0));

// Long enough for confirmBasemapFailure's own grace period to run out, so what it does about a
// basemap that really didn't arrive has happened by the time it comes back
const settleBasemap = () => new Promise<void>(resolve => setTimeout(resolve, 400));

// What MapLibre hands a map error listener. The style document's own failure arrives with no source
// on it - there are no sources yet - and a tile's arrives named after the source it belongs to.
const mapError = (sourceId?: string) => ({ error: new Error('Failed to fetch'), sourceId }) as never;

const raiseMapError = (el: HTMLElement, sourceId?: string) => (el as unknown as { handleMapError: (event: never) => void }).handleMapError(mapError(sourceId));

const notices = (el: HTMLElement) => Array.from((el.shadowRoot as ShadowRoot).querySelectorAll('wa-callout.notice'));
const noticeTexts = (el: HTMLElement) => notices(el).map(callout => callout.textContent ?? '');
const noticeVariants = (el: HTMLElement) => notices(el).map(callout => callout.getAttribute('variant'));
const basemapUrl = (el: HTMLElement) => (el.shadowRoot as ShadowRoot).querySelector('.basemap-url');

const fitTo = (el: HTMLElement, mapBounds: number[][]) => (el as unknown as { fitMapBounds: (bounds: number[][]) => Promise<void> }).fitMapBounds(mapBounds);

// Set a property the theme reads, on the element it reads from - the scope inside the shadow root,
// not the host. Same reason MapLibreTheme's own tests declare them on the element under test: happy-dom
// resolves a custom property set on that element but doesn't inherit one down the tree, and reaching in
// from the host - which is how an embedding page actually sets these - is inheritance doing its job.
const setThemeProperty = (el: HTMLElement, property: string, value: string) => {
  const scope = (el.shadowRoot as ShadowRoot).querySelector('.container') as HTMLElement;
  scope.style.setProperty(property, value);
};

// What MapLibre's own handlers do between them once it has a style document: the map takes writes, the
// component knows it does, and whatever preview is attached is drawn into it. There is no map here to
// fire style.load or load on, so the two of them stand in for the pair.
const styleLoads = async (el: HTMLElement, map: ReturnType<typeof loadingMap>) => {
  map.styleLoaded = true;
  Object.assign(el, { mapStyleLoaded: true });
  await (el as unknown as { loadPreview: () => Promise<void> }).loadPreview();
};

const containers: HTMLElement[] = [];
let consoleError: ReturnType<typeof vi.spyOn>;

// Stencil catches what a host listener throws and reports it through console.error rather than
// letting it reach the page, so that is what a crash in one looks like from here.
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  containers.splice(0).forEach(container => container.remove());
  consoleError.mockRestore();
});

// `lightBasemap` for the tests that need to know which basemap this map was asked for by name, rather
// than asserting against whichever CARTO default the theme currently carries
const renderMap = async (lightBasemap?: string) => {
  const container = document.createElement('div');
  containers.push(container);
  document.body.appendChild(container);
  await stencilRender(<ogm-map lightBasemap={lightBasemap}></ogm-map>, container);
  const el = container.firstElementChild as HTMLElement & { componentOnReady?: () => Promise<unknown> };
  await el.componentOnReady?.();
  // Nothing under test has run yet, so anything reported on the way up is noise from mounting
  consoleError.mockClear();
  return { container, el };
};

const selection = () => new CustomEvent('featureSelected', { detail: feature, bubbles: true, composed: true });

// MapLibre builds the popup inside the map's container, so a selection made in one starts inside the
// map's shadow root and crosses out of it. Standing in for the popup rather than opening one, since
// there is no map here to open it on.
const selectInOwnPopup = (el: HTMLElement) => {
  const popup = document.createElement('div');
  (el.shadowRoot as ShadowRoot).appendChild(popup);
  popup.dispatchEvent(selection());
};

describe('ogm-map', () => {
  it('highlights a feature selected in its own popup', async () => {
    const { el } = await renderMap();
    const map = fakeMap();
    Object.assign(el, { map });

    selectInOwnPopup(el);

    expect(map.setFeatureState).toHaveBeenCalledWith({ source: 'a-preview', id: 'sheet.1', sourceLayer: undefined }, { selected: true });
  });

  // Every preview of a record has a map of its own, and they all sit in the same document
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

  // A map used on its own has to establish the Web Awesome palette for itself, and the classes that do
  // it are matched by the stylesheet in its own shadow root - which can't match the host of that root.
  // On the Host alone they establish nothing, and the theme reads every color as the empty string.
  it('establishes the Web Awesome scope on an element inside its own shadow root', async () => {
    const { el } = await renderMap();
    const root = el.shadowRoot as ShadowRoot;

    const scope = root.querySelector('.container') as HTMLElement;

    expect(scope.classList.contains('wa-palette-default')).toBe(true);
    // Everything drawn has to be under it, the layer panel as much as the map
    expect(scope.querySelector('#map')).toBeTruthy();
  });

  // GeoBlacklight hands over its own basemap this way - a URL to a style document for each mode -
  // and componentDidLoad runs far enough to build the theme even though it never gets as far as a
  // map here; see the note on renderMap above.
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

  // Left to itself MapLibre fits bounds to the very edges of the canvas, which puts a record's own
  // edges - an index map's outermost sheets, a bounding box's corners - half off the map
  it('keeps the theme’s gap between the bounds it fits and the edge of the map', async () => {
    const { el } = await renderMap();
    setThemeProperty(el, '--ogm-padding', '50');
    Object.assign(el, { map: fittableMap() });

    await fitTo(el, bounds);

    expect((el as unknown as { map: ReturnType<typeof fittableMap> }).map.fitBounds).toHaveBeenCalledWith(bounds, { padding: 50, animate: false });
  });

  // What the sidebar covers is the map's own padding, which MapLibre already takes off the space it
  // fits into. Asking for it here as well would fit the preview into a viewport that much narrower.
  it('leaves the room the sidebar takes out of what it asks for', async () => {
    const { el } = await renderMap();
    setThemeProperty(el, '--ogm-padding', '50');
    Object.assign(el, { map: fittableMap(), padding: 400 });

    await fitTo(el, bounds);

    expect((el as unknown as { map: ReturnType<typeof fittableMap> }).map.fitBounds).toHaveBeenCalledWith(bounds, { padding: 50, animate: false });
  });

  // Only a standalone <ogm-map> gets here: under <ogm-preview> the previewer arrives as an initial prop,
  // so the watcher never fires in the window before the style has loaded. Writing to a style document
  // that hasn't loaded throws, and the watcher that lands a preview is async - so what it threw escaped
  // as an unhandled rejection instead of reaching reportError, and the preview never drew.
  it('holds a preview handed to it before its style has loaded, then draws it', async () => {
    const { el } = await renderMap();
    const map = loadingMap();
    const previewer = drawablePreviewer();
    const reported = vi.fn();
    el.addEventListener('previewError', reported);
    Object.assign(el, { map, layersControl: fakeLayersControl() });

    Object.assign(el, { previewer });
    await settle();

    // Nothing written to the style, nothing drawn into it, and nothing thrown on the way past
    expect(map.setProjection).not.toHaveBeenCalled();
    expect(previewer.preview).not.toHaveBeenCalled();
    expect(reported).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();

    await styleLoads(el, map);

    // The whole load ran this time, down to moving the map to what it drew
    expect(previewer.preview).toHaveBeenCalled();
    expect(map.fitBounds).toHaveBeenCalled();
    expect(reported).not.toHaveBeenCalled();
  });

  // Waiting on the style is all that guard is about: a preview that can't be drawn on a globe still has
  // to flatten the map it lands on, and tilt it no further than it can be drawn tilted
  it('draws a preview that needs a flat map on one', async () => {
    const { el } = await renderMap();
    const map = loadingMap();
    Object.assign(el, { map, layersControl: fakeLayersControl(), previewer: drawablePreviewer() });

    await styleLoads(el, map);

    expect(map.setProjection).toHaveBeenCalledWith({ type: 'mercator' });
    expect(map.setMaxPitch).toHaveBeenCalledWith(30);
  });

  // <ogm-viewer> counts these in pairs, so an unmatched one either sticks the spinner on for good
  // or turns it off while something else is still loading
  describe('while tiles of the preview are arriving', () => {
    // Enough of a MapLibre map to decide when it is idle the way MapLibre does: only at the end of a
    // frame, and only drawing a frame when something asks for one. Nothing is ever outstanding here,
    // so every frame it is asked for ends idle - as MapLibre's does once the last tile it was waiting
    // on has failed.
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

    // A tile that fails asks MapLibre for no frame, and 'idle' only comes at the end of one, so a
    // batch whose last tile failed left the spinner turning until the reader moved the map
    it('says it is done once the last tile it was waiting on has failed', async () => {
      const { el, map, said } = await tileLoading();

      map.handleSourceDataLoading({ sourceId: 'a-preview' });
      raiseMapError(el, 'a-preview');
      await settle();

      expect(said).toEqual(['start', 'stop']);
    });

    // Only the first failure of a load attempt is reported, but every batch is waited on the same way:
    // a reader who pans on after the alert is waiting on tiles that fail just as the first ones did
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

    // 'idle' waits on every source on the map, so a basemap tile that fails last strands it the same way
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

    // NASA GIBS answers a few percent of its WMTS tiles with a 500 that succeeds on retry, so with a
    // couple dozen tiles in view nearly every preview lost one - and the alert for it hid a map that
    // had drawn fine
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

      // The spinner is waited on the same way whether or not the failure was reported: a tile kept
      // quiet about still asks MapLibre for no frame of its own
      it('still says the batch is done', async () => {
        const { el, map, said } = await failing();

        tileArrives(el);
        map.handleSourceDataLoading({ sourceId: 'a-preview' });
        tileFails(el);
        await settle();

        expect(said).toEqual(['start', 'stop']);
      });

      // Nothing on the map yet, so this may be the only answer the preview is ever going to give
      it('still reports one that fails before anything has drawn', async () => {
        const { el, reported, warn } = await failing();

        tileFails(el);
        await settle();

        expect(reported).toHaveBeenCalledTimes(1);
        expect(reported.mock.calls[0][0].detail.message).toContain('HTTP 500');
        expect(warn).not.toHaveBeenCalled();
      });

      // Not a hole in the map: the source itself has gone
      it('still reports a failure of the whole source after drawing', async () => {
        const { el, reported } = await failing();

        tileArrives(el);
        raiseMapError(el, 'a-preview');
        await settle();

        expect(reported).toHaveBeenCalledTimes(1);
      });
    });
  });

  // A preview only knows how far out it has anything to draw once it has read its own service, so
  // this is the one constraint that has to be applied again after preview() rather than only before
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

  // MapLibre reads an absent floor as its own default of -2, which is further out than this map has
  // ever opened, so a preview asking for nothing has to be given the map's own floor back
  it('puts its own floor back for a preview that asks for none', async () => {
    const { el } = await renderMap();
    const map = loadingMap();
    Object.assign(el, { map, layersControl: fakeLayersControl(), previewer: drawablePreviewer() });

    await styleLoads(el, map);

    expect(map.setMinZoom).toHaveBeenLastCalledWith(1);
  });

  // A slim vector preview has the rest of its attributes a request away, and a click is when that
  // request is worth making - see MapPreviewer.expandFeatures
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

  // An index map stacks a sheet's editions under one label, and which of them has it is down to how
  // MapLibre placed its labels. A label is drawn over every shape, so a click on it used to open at
  // that edition and only then go down the stack from the top.
  describe('over a stack of editions sharing one label', () => {
    const edition = (id: number, layer: { id: string; type: string }) =>
      ({ ...feature, id, layer: { ...layer, source: 'a-preview' }, properties: { label: `Bright Angel ${id}` } }) as unknown as MapGeoJSONFeature;
    const label = (id: number) => edition(id, { id: 'a-preview-polygon-labels', type: 'symbol' });
    const fill = (id: number) => edition(id, { id: 'a-preview-polygons', type: 'fill' });

    // What MapLibre answers with, top down: the label, then the fills from the top of the stack
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

    // Hover says what a click would open at, so it can't light up an edition buried under the rest
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
    // Telling a reader how to use the view they're in, rather than warning them about it
    expect(noticeVariants(el)).toEqual(['brand']);
  });

  // A WMTS layer's <LegendURL>s ride on its row in the layers panel, the way a COG's ramp does
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

    // A picture limited to closer views than the map is at describes nothing on it yet
    it('shows a picture limited to some scales only once the map is zoomed to them', async () => {
      const { el } = await renderMap();
      const map = loadingMap();
      const detail = { url: 'https://example.org/legend/detail.png', maxScaleDenominator: 1_000_000 };
      Object.assign(el, { map, layersControl: fakeLayersControl(), previewer: pictured([detail]), zoom: 3 });

      await styleLoads(el, map);
      await settle();
      expect(legend(el)).toBeNull();

      // What the map's zoomend listener does, about 1:68,000 in
      Object.assign(el, { zoom: 12 });
      await settle();
      expect(legend(el)?.zoom).toEqual(12);
    });

    // A theme change draws the whole preview again, the legend with it
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

  // A WMTS layer with a Time dimension rides on its row in the layers panel too, the way a legend does
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

  // The failure this is all about: a basemap that never loads fires no style.load, and everything a
  // preview needs waits on one - so the preview used to be abandoned unattempted, silently, with not
  // one request made for the data. See fallBackToEmptyBasemap.
  it('draws on an empty basemap when the real one never arrives, and names it', async () => {
    const { el } = await renderMap('https://example.com/light.json');
    const map = loadingMap();
    const previewer = drawablePreviewer();
    const reported = vi.fn();
    el.addEventListener('previewError', reported);
    Object.assign(el, { map, layersControl: fakeLayersControl(), previewer });

    raiseMapError(el);
    await settleBasemap();

    // A style document of our own, needing nothing from the network that just failed
    expect(map.setStyle).toHaveBeenCalledWith(expect.objectContaining({ version: 8, sources: {} }));

    // Part of the map isn't there, which is not the same kind of thing as a preview's own notice
    expect(noticeVariants(el)).toEqual(['warning']);
    expect(reported).not.toHaveBeenCalled();

    // Named rather than left to the console, and the whole of it however narrow the map is
    expect(basemapUrl(el)?.textContent).toBe('https://example.com/light.json');
    expect(basemapUrl(el)?.getAttribute('title')).toBe('https://example.com/light.json');
  });

  // The grace period is a window the map can be taken off the page inside, and the map it would have
  // written to is still sitting there - disconnectedCallback removes it rather than dropping it
  it('leaves a failed basemap alone once its map has been taken off the page', async () => {
    const { container, el } = await renderMap();
    const map = loadingMap();
    Object.assign(el, { map, layersControl: fakeLayersControl(), previewer: drawablePreviewer() });

    raiseMapError(el);
    container.removeChild(el);
    await settleBasemap();

    expect(map.setStyle).not.toHaveBeenCalled();
  });

  // A style document asks for its own sprite and glyphs, and either can fail before style.load lands.
  // Read as the style itself having failed, that would throw away a basemap that was on its way.
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

  // A basemap drops tiles for all sorts of ordinary reasons, and one that came up with holes in it is
  // still a backdrop with the preview drawn over it. Saying so put a warning on maps a reader could
  // see were fine, and often - these arrive one per tile.
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
    // Not the preview's failure either: it is drawn on whatever is left of the basemap, rather than
    // reported or started over on an empty one
    expect(reported).not.toHaveBeenCalled();
    expect(map.setStyle).not.toHaveBeenCalled();
  });

  // Both can be up at once, and they don't mean the same thing: one is about how to read the view,
  // the other about the map under it being missing
  it('tells its two kinds of notice apart when both are up', async () => {
    const { el } = await renderMap();
    const map = loadingMap();
    const previewer = drawablePreviewer();
    Object.assign(el, { map, layersControl: fakeLayersControl(), previewer });

    raiseMapError(el);
    await settleBasemap();
    // The empty style the fallback hands over fires style.load like any other, which is what lets the
    // preview - and so its notice - arrive on a map that lost its basemap
    await styleLoads(el, map);
    previewer.onNotice?.('Zoom in to see this layer’s features.');
    await settle();

    // The preview's own comes first, in document order
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

  // NASA GIBS serves each of its XYZ layers down to a zoom of its own - this one stops at 7 - and
  // answers anything deeper with a 400, which used to replace the whole map with an alert as soon as
  // a reader zoomed in past it
  describe('over an XYZ service that stops short of where the reader zooms to', () => {
    const TEMPLATE = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GHRSST_L4_MUR_Sea_Surface_Temperature/default/default/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png';
    const SOURCE = 'ghrsst-xyz';

    // Enough of a map for the preview to draw itself onto, and to be held to a depth on
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

    // What MapLibre hands a listener about one tile: the zoom it was asked for is all either side reads
    const tile = (z: number) => ({ tileID: { canonical: { z, x: 0, y: 0 } } });

    const handlers = (el: HTMLElement) =>
      el as unknown as {
        handleSourceData: (event: unknown) => void;
        handleMapError: (event: unknown) => void;
      };

    const tileArrives = (el: HTMLElement, z: number) => handlers(el).handleSourceData({ sourceId: SOURCE, tile: tile(z) });
    const tileFails = (el: HTMLElement, z: number) =>
      handlers(el).handleMapError({ error: Object.assign(new Error('Bad Request'), { status: 400 }), sourceId: SOURCE, tile: tile(z) });

    // Drawn by hand rather than through loadPreview, which would also fit the camera and wait on a
    // first tile; what's under test is what the map does with the tiles that arrive afterwards
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

    // A template that answers nothing at all, at the zoom the preview opened at, is a broken
    // reference - not one that runs out of tiles
    it('still reports a first tile that fails', async () => {
      const { el, reported } = await xyzMap();

      tileFails(el, 3);
      await settle();

      expect(reported).toHaveBeenCalledTimes(1);
      expect(reported.mock.calls[0][0].detail.message).toContain('HTTP 400');
    });

    // A zoom that has drawn has tiles to give, so this one is a stray failure rather than the bottom of
    // the service: the preview stays up, and isn't held any shallower for it
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

  // The popup is built by hand rather than rendered, so it outlives the component's own markup
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
