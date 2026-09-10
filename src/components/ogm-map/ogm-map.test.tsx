import { describe, it, expect, h, vi, beforeEach, afterEach } from '@stencil/vitest';
import type { MapGeoJSONFeature } from 'maplibre-gl';

// Render with Stencil's low-level render rather than @stencil/vitest's `render` wrapper, for the same
// reason ogm-preview's tests do: the wrapper re-throws whatever a lifecycle method leaves behind.
// componentDidLoad never gets as far as a map here - happy-dom lays nothing out, so the container
// never has the box whenSized waits for. That leaves the component mounted and listening with no map
// of its own, which is the state a freshly mounted <ogm-map> is in for real until it has been shown,
// and the state a selection used to crash it in. What needs one is handed a fake afterwards.
import { render as stencilRender } from '@stencil/core';

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
    const tileLoading = async () => {
      const { el } = await renderMap();
      const previewer = drawablePreviewer();
      previewer.sourceIds = ['a-preview'];
      Object.assign(el, { previewer });

      const said: string[] = [];
      el.addEventListener('mapLoading', () => said.push('start'));
      el.addEventListener('mapIdle', () => said.push('stop'));

      const map = el as unknown as {
        handleSourceDataLoading: (event: { sourceId: string }) => void;
        settleTileLoading: () => void;
        tilesLoading: boolean;
      };
      return { el, map, said };
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

  // Every one of these used to be dropped: the filter asked whether the failure was one of the
  // preview's own sources, and a preview that paints its own pixels has none - so a map that had lost
  // its backdrop tile by tile said nothing at all about why.
  it('says the basemap is missing when its tiles fail, without failing the preview', async () => {
    const { el } = await renderMap('https://example.com/light.json');
    const map = loadingMap();
    const previewer = drawablePreviewer();
    const reported = vi.fn();
    el.addEventListener('previewError', reported);
    Object.assign(el, { map, layersControl: fakeLayersControl(), previewer });

    await styleLoads(el, map);
    raiseMapError(el, 'carto');
    await settle();

    // A basemap with holes in it, not a missing one - a reader can see the difference, so the notice
    // shouldn't claim the preview is drawn without a basemap
    expect(noticeTexts(el).join()).toContain('Part of the basemap');
    expect(reported).not.toHaveBeenCalled();
    // The preview is drawn on whatever is left of the basemap, rather than started over on an empty one
    expect(map.setStyle).not.toHaveBeenCalled();

    // The style document either way: the tile URLs come from inside it, so it is the thing to name
    expect(basemapUrl(el)?.textContent).toBe('https://example.com/light.json');
  });

  // Both can be up at once, and they don't mean the same thing: one is about how to read the view,
  // the other about the map under it being incomplete
  it('tells its two kinds of notice apart when both are up', async () => {
    const { el } = await renderMap();
    const map = loadingMap();
    const previewer = drawablePreviewer();
    Object.assign(el, { map, layersControl: fakeLayersControl(), previewer });

    await styleLoads(el, map);
    previewer.onNotice?.('Zoom in to see this layer’s features.');
    raiseMapError(el, 'carto');
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
