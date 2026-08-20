/** @vitest-environment happy-dom */
// A DOM, for the controls at the bottom of the file: MapLibre's own build their buttons as they are
// added, and there is no way to check what a map ends up offering without letting them. The same
// reason globe-control.test.ts asks for one.
import { describe, it, expect, vi, beforeEach, afterEach } from '@stencil/vitest';

import { WORLD } from './geometry';
import { addLocationControls, disableRotation, fitBounds, frameLocation, trackContainerSize, whenSized } from './maps';
import type Theme from './themes/theme';
import type MapLibreTheme from './themes/maplibre';

const PADDING = 50;
const theme = { getPadding: () => PADDING } as Theme;

const BOUNDS: [[number, number], [number, number]] = [
  [-124.41, 32.53],
  [-114.13, 42.01],
];

// Enough of a MapLibre map to be pointed somewhere: it can work out a camera, it can be moved, and
// it reports the move as having finished, which is what fitBounds waits for before resolving. It also
// answers how big its canvas is, since that is what decides how much of a gap it can spare.
const fittableMap = (cameraForBounds = vi.fn(() => ({ center: [0, 0], zoom: 4 })), canvas = { clientWidth: 800, clientHeight: 600 }) => ({
  cameraForBounds,
  fitBounds: vi.fn(),
  getCanvas: () => canvas,
  once: vi.fn((_event: string, listener: () => void) => listener()),
});

describe('fitBounds', () => {
  it('should wait for the map to finish moving', async () => {
    const map = fittableMap();
    await fitBounds(map as unknown as maplibregl.Map, theme, BOUNDS);

    expect(map.fitBounds).toHaveBeenCalledWith(BOUNDS, { padding: PADDING });
    expect(map.once).toHaveBeenCalledWith('moveend', expect.any(Function));
  });

  // So a record's own edges read as edges instead of running off the canvas
  it('should keep the theme’s gap between the bounds and the edge', async () => {
    const map = fittableMap();
    await fitBounds(map as unknown as maplibregl.Map, { getPadding: () => 8 } as Theme, BOUNDS);

    expect(map.fitBounds).toHaveBeenCalledWith(BOUNDS, { padding: 8 });
  });

  // What a caller wants of this one camera, as against the limits it set on the map itself: those
  // hold for every camera, including the ones a reader drives with a wheel. Asked of the solve as
  // well as of the move, so the two can't disagree about whether the bounds can be framed at all.
  it('should carry the caller’s own camera options into both the solve and the move', async () => {
    const map = fittableMap();
    await fitBounds(map as unknown as maplibregl.Map, theme, BOUNDS, { maxZoom: 12 });

    expect(map.cameraForBounds).toHaveBeenCalledWith(BOUNDS, { padding: PADDING, maxZoom: 12 });
    expect(map.fitBounds).toHaveBeenCalledWith(BOUNDS, { padding: PADDING, maxZoom: 12 });
  });

  // MapLibre has no camera for bounds it can't fit the padding inside, and the guard below reads that
  // as "leave the camera alone" - so without this a pane shorter than twice the gap would sit at
  // whatever view it opened on, with what it was pointed at off screen and nothing saying so.
  it('should give up the gap rather than the framing on a map too small for both', async () => {
    const map = fittableMap(undefined, { clientWidth: 300, clientHeight: 120 });
    await fitBounds(map as unknown as maplibregl.Map, theme, BOUNDS);

    expect(map.fitBounds).toHaveBeenCalledWith(BOUNDS, { padding: 30 });
  });

  it('should ask for the whole gap on a map with room for it', async () => {
    const map = fittableMap(undefined, { clientWidth: 800, clientHeight: 400 });
    await fitBounds(map as unknown as maplibregl.Map, theme, BOUNDS);

    expect(map.fitBounds).toHaveBeenCalledWith(BOUNDS, { padding: PADDING });
  });

  it('should leave the camera alone when there is no camera that would frame the bounds', async () => {
    const map = fittableMap(vi.fn(() => undefined) as never);
    await fitBounds(map as unknown as maplibregl.Map, theme, BOUNDS);

    expect(map.fitBounds).not.toHaveBeenCalled();
  });

  // The same non-answer, arriving differently: on a globe MapLibre reads its own undefined and
  // throws, because the globe solve takes the flat camera and only corrects its zoom. Either way
  // there is nowhere to point, and neither is the preview's failure to report.
  it('should leave the camera alone when a globe throws over bounds it cannot frame', async () => {
    const map = fittableMap(
      vi.fn(() => {
        throw new TypeError("Cannot read properties of undefined (reading 'center')");
      }) as never,
    );

    await expect(fitBounds(map as unknown as maplibregl.Map, theme, BOUNDS)).resolves.toBeUndefined();
    expect(map.fitBounds).not.toHaveBeenCalled();
  });
});

// Enough of a ResizeObserver to drive by hand: it keeps the callback it was built with, so a test can
// deliver an observation whenever it wants one rather than waiting on a layout that never happens.
class FakeResizeObserver {
  static last: FakeResizeObserver | undefined;
  observed: Element[] = [];
  disconnected = false;

  constructor(private callback: () => void) {
    FakeResizeObserver.last = this;
  }

  observe(element: Element) {
    this.observed.push(element);
  }

  unobserve() {}

  disconnect() {
    this.disconnected = true;
  }

  // What the browser would deliver; the first one is the size the map was built at
  deliver(times = 1) {
    for (let i = 0; i < times; i += 1) this.callback();
  }
}

// Enough of a MapLibre map to be resized and then taken down, holding onto the one-shot listener so
// a test can fire the 'remove' the real map fires on its way out.
const resizableMap = () => {
  const listeners: Record<string, () => void> = {};
  return {
    resize: vi.fn(),
    redraw: vi.fn(),
    once: vi.fn((event: string, listener: () => void) => {
      listeners[event] = listener;
    }),
    fire: (event: string) => listeners[event]?.(),
  };
};

// A container is only ever asked how big it is, and a hidden one answers zero
const container = (clientWidth: number, clientHeight: number) => ({ clientWidth, clientHeight }) as HTMLElement;

// Watch the given container, hand back the map and the observer now watching it, and deliver the
// first observation - the one that reports the size the map was already built at.
const track = (element: HTMLElement) => {
  const map = resizableMap();
  trackContainerSize(map as unknown as maplibregl.Map, element);
  const observer = FakeResizeObserver.last!;
  observer.deliver();
  return { map, observer };
};

describe('trackContainerSize', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    FakeResizeObserver.last = undefined;
  });

  it('should watch the container it was given', () => {
    const element = container(800, 400);
    const { observer } = track(element);

    expect(observer.observed).toEqual([element]);
  });

  // The map is already that size, and cutting in here would stop the camera opening the preview
  it('should leave the first observation alone', () => {
    const map = resizableMap();
    trackContainerSize(map as unknown as maplibregl.Map, container(800, 400));
    FakeResizeObserver.last!.deliver();

    expect(map.resize).not.toHaveBeenCalled();
  });

  it('should resize and redraw when the container changes size', () => {
    const { map, observer } = track(container(800, 400));
    observer.deliver();

    expect(map.resize).toHaveBeenCalledTimes(1);
    expect(map.redraw).toHaveBeenCalledTimes(1);
  });

  // The one this exists for: MapLibre reads a container with no box as a 400x300 one and resizes the
  // canvas to match, and deck.gl's overlay copies that size off the shared canvas and stamps it back
  // once the map is shown again. A hidden map is not a small map, so there is nothing to resize to.
  it('should leave a container with no box alone', () => {
    const { map, observer } = track(container(0, 0));
    observer.deliver();

    expect(map.resize).not.toHaveBeenCalled();
  });

  it('should still resize once a hidden container has its box back', () => {
    const element = container(0, 0);
    const { map, observer } = track(element);
    observer.deliver();

    Object.assign(element, { clientWidth: 800, clientHeight: 400 });
    observer.deliver();

    expect(map.resize).toHaveBeenCalledTimes(1);
  });

  // A container on its way to a new size is observed every frame, and each resize reallocates the
  // drawing buffer; the size it ends at still has to be the size it is left at.
  it('should collapse a burst of observations, ending at the last one', () => {
    const { map, observer } = track(container(800, 400));
    observer.deliver(5);

    expect(map.resize).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(50);
    expect(map.resize).toHaveBeenCalledTimes(2);

    // Nothing was asked for after that one, so it is the last
    vi.advanceTimersByTime(500);
    expect(map.resize).toHaveBeenCalledTimes(2);
  });

  it('should stop watching once the map is removed', () => {
    const { map, observer } = track(container(800, 400));
    map.fire('remove');

    expect(observer.disconnected).toBe(true);
  });
});

describe('whenSized', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    FakeResizeObserver.last = undefined;
  });

  it('should resolve straight away for an element that already has a box', async () => {
    await expect(whenSized(container(800, 400))).resolves.toBeUndefined();
    // Nothing to wait for, so nothing to watch either
    expect(FakeResizeObserver.last).toBeUndefined();
  });

  // What a map mounted inside a `display: none` subtree waits on. MapLibre would read the container
  // as a 400x300 one and build a canvas that size, which deck.gl's overlay then copies as it attaches.
  it('should wait for an element with no box to be given one', async () => {
    const element = container(0, 0);
    let resolved = false;
    const sized = whenSized(element).then(() => (resolved = true));

    const observer = FakeResizeObserver.last!;
    expect(observer.observed).toEqual([element]);

    // Still nothing to measure: the observation a hidden element delivers is not the one to build on
    observer.deliver();
    await Promise.resolve();
    expect(resolved).toBe(false);

    Object.assign(element, { clientWidth: 800, clientHeight: 400 });
    observer.deliver();

    await expect(sized).resolves.toBe(true);
    expect(observer.disconnected).toBe(true);
  });
});

// A theme is only ever asked for the two gaps, and a location map is framed with the wider one
const locationTheme = { getPadding: () => 8, getOverviewPadding: () => 64 } as MapLibreTheme;

describe('frameLocation', () => {
  it('should leave the overview gap around what it frames', async () => {
    const map = fittableMap();
    await frameLocation(map as unknown as maplibregl.Map, locationTheme, BOUNDS, false);

    expect(map.fitBounds).toHaveBeenCalledWith(BOUNDS, { padding: 64 });
  });

  it('should carry the caller’s own camera options', async () => {
    const map = fittableMap();
    await frameLocation(map as unknown as maplibregl.Map, locationTheme, BOUNDS, false, { maxZoom: 12 });

    expect(map.fitBounds).toHaveBeenCalledWith(BOUNDS, { padding: 64, maxZoom: 12 });
  });

  // A globe camera has no answer for anything wider than the half of the world facing it: it hands
  // back nothing and the camera stays put, so half of a wide area is what gets framed instead.
  it('should hold a globe camera to the half of the world it can face', async () => {
    const map = fittableMap();
    await frameLocation(map as unknown as maplibregl.Map, locationTheme, WORLD, true);

    const [bounds] = map.fitBounds.mock.calls[0] as unknown as [maplibregl.LngLatBounds];
    expect(bounds.getEast() - bounds.getWest()).toEqual(180);
    expect(bounds.getCenter().lng).toEqual(0);
  });

  it('should point a flat map at the whole of the same area', async () => {
    const map = fittableMap();
    await frameLocation(map as unknown as maplibregl.Map, locationTheme, WORLD, false);

    expect(map.fitBounds).toHaveBeenCalledWith(WORLD, { padding: 64 });
  });

  // Nothing to clamp, so a globe gets what it was given
  it('should leave an area a globe can face where it is', async () => {
    const map = fittableMap();
    await frameLocation(map as unknown as maplibregl.Map, locationTheme, BOUNDS, true);

    const [bounds] = map.fitBounds.mock.calls[0] as unknown as [maplibregl.LngLatBounds];
    expect([bounds.getWest(), bounds.getEast()]).toEqual([-124.41, -114.13]);
  });
});

// Enough of a map to hang controls on. MapLibre's own read all of this as they are added: the
// navigation control asks for its titles and for the zoom limits to grey its buttons at, and the
// globe control asks which projection it should be showing.
const controllableMap = () => {
  const controls: { control: maplibregl.IControl; element: HTMLElement }[] = [];
  const pending: Record<string, (() => void)[]> = {};

  return {
    controls,
    addControl(control: maplibregl.IControl) {
      controls.push({ control, element: control.onAdd(this as unknown as maplibregl.Map) });
    },
    // Held rather than run, so a test can say when the style arrives
    once(event: string, listener: () => void) {
      (pending[event] ??= []).push(listener);
    },
    fire(event: string) {
      (pending[event] ?? []).splice(0).forEach(listener => listener());
    },
    on: () => {},
    off: () => {},
    _getUIString: (key: string) => key,
    getZoom: () => 4,
    getMinZoom: () => 0,
    getMaxZoom: () => 22,
    getProjection: () => ({ type: 'globe' }),
    keyboard: { disableRotation: vi.fn() },
    touchZoomRotate: { disableRotation: vi.fn() },
  };
};

describe('disableRotation', () => {
  // `dragRotate: false` looks like it covers this and doesn't: the keyboard's shift+arrows and the
  // two-finger pinch-rotate are each a handler of their own.
  it('should turn off the two gestures a map option cannot name', () => {
    const map = controllableMap();
    disableRotation(map as unknown as maplibregl.Map);

    expect(map.keyboard.disableRotation).toHaveBeenCalled();
    expect(map.touchZoomRotate.disableRotation).toHaveBeenCalled();
  });
});

describe('addLocationControls', () => {
  it('should offer zoom buttons and no compass', () => {
    const map = controllableMap();
    addLocationControls(map as unknown as maplibregl.Map);

    const { element } = map.controls[0];
    expect(Array.from(element.querySelectorAll('button'), button => button.className)).toEqual(['maplibregl-ctrl-zoom-in', 'maplibregl-ctrl-zoom-out']);
    expect(element.querySelector('.maplibregl-ctrl-compass')).toBeNull();
  });

  // Its click reaches a style document, and asking one that isn't there yet throws. The window
  // between building a map and the basemap's style landing is easy to click in on a map this small.
  it('should wait for a style document before offering the projection toggle', () => {
    const map = controllableMap();
    addLocationControls(map as unknown as maplibregl.Map);

    expect(map.controls).toHaveLength(1);

    map.fire('style.load');

    expect(map.controls).toHaveLength(2);
    expect(map.controls[1].element.querySelector('[class^="maplibregl-ctrl-globe"]')).toBeTruthy();
  });

  // A theme swap brings a second style document with it, and the button is already on the map
  it('should offer the projection toggle once, however many styles arrive', () => {
    const map = controllableMap();
    addLocationControls(map as unknown as maplibregl.Map);
    map.fire('style.load');
    map.fire('style.load');

    expect(map.controls).toHaveLength(2);
  });
});
