import { describe, it, expect, h, vi, beforeEach, afterEach } from '@stencil/vitest';
import type { MapGeoJSONFeature } from 'maplibre-gl';

// Render with Stencil's low-level render rather than @stencil/vitest's `render` wrapper, for the same
// reason ogm-preview's tests do: the wrapper re-throws lifecycle errors, and componentDidLoad throws
// here when MapLibre can't get a WebGL context. That failure is useful - it leaves the component
// mounted and listening with no map of its own, which is the state a freshly mounted <ogm-map> is in
// for real until componentDidLoad has run, and the state a selection used to crash it in.
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

// Enough of one to fit bounds on: it can work out a camera for them, it can be moved, and it reports
// the move as having finished, which is what fitMapBounds waits for before resolving.
const fittableMap = () => ({
  cameraForBounds: vi.fn(() => ({ center: [0, 0], zoom: 4 })),
  fitBounds: vi.fn(),
  easeTo: vi.fn(),
  once: vi.fn((_event: string, listener: () => void) => listener()),
  remove: vi.fn(),
});

const bounds = [
  [0, 0],
  [1, 1],
];

const fitTo = (el: HTMLElement, mapBounds: number[][]) => (el as unknown as { fitMapBounds: (bounds: number[][]) => Promise<void> }).fitMapBounds(mapBounds);

// Set a property the theme reads, on the element it reads from - the scope inside the shadow root,
// not the host. Same reason MapLibreTheme's own tests declare them on the element under test: happy-dom
// resolves a custom property set on that element but doesn't inherit one down the tree, and reaching in
// from the host - which is how an embedding page actually sets these - is inheritance doing its job.
const setThemeProperty = (el: HTMLElement, property: string, value: string) => {
  const scope = (el.shadowRoot as ShadowRoot).querySelector('.container') as HTMLElement;
  scope.style.setProperty(property, value);
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

const renderMap = async () => {
  const container = document.createElement('div');
  containers.push(container);
  document.body.appendChild(container);
  await stencilRender(<ogm-map></ogm-map>, container);
  const el = container.firstElementChild as HTMLElement & { componentOnReady?: () => Promise<unknown> };
  await el.componentOnReady?.();
  // Anything componentDidLoad reported on the way up is the WebGL gap, not what's under test
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

  // Left to itself MapLibre fits bounds to the very edges of the canvas, which puts a record's own
  // edges - an index map's outermost sheets, a bounding box's corners - half off the map
  it('keeps the theme’s gap between the bounds it fits and the edge of the map', async () => {
    const { el } = await renderMap();
    setThemeProperty(el, '--ogm-padding', '50');
    Object.assign(el, { map: fittableMap() });

    await fitTo(el, bounds);

    expect((el as unknown as { map: ReturnType<typeof fittableMap> }).map.fitBounds).toHaveBeenCalledWith(bounds, { padding: 50 });
  });

  // What the sidebar covers is the map's own padding, which MapLibre already takes off the space it
  // fits into. Asking for it here as well would fit the preview into a viewport that much narrower.
  it('leaves the room the sidebar takes out of what it asks for', async () => {
    const { el } = await renderMap();
    setThemeProperty(el, '--ogm-padding', '50');
    Object.assign(el, { map: fittableMap(), padding: 400 });

    await fitTo(el, bounds);

    expect((el as unknown as { map: ReturnType<typeof fittableMap> }).map.fitBounds).toHaveBeenCalledWith(bounds, { padding: 50 });
  });

  // The popup is built by hand rather than rendered, so it outlives the component's own markup
  it('ignores a feature selection after it has been removed from the DOM', async () => {
    const { container, el } = await renderMap();
    container.removeChild(el);

    selectInOwnPopup(el);

    expect(consoleError).not.toHaveBeenCalled();
  });
});
