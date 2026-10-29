/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach, afterEach } from '@stencil/vitest';
import type { IControl, LngLatBounds, MapLibreMap } from 'maplibre-gl';

import { WORLD } from './geometry';
import { addLocationControls, disableRotation, fitBounds, frameLocation, openingCamera, openingLocation, readProjection, trackContainerSize, whenSized } from './maps';
import type Theme from './themes/theme';
import type MapLibreTheme from './themes/maplibre';

const PADDING = 50;
const theme = { getPadding: () => PADDING } as Theme;

const BOUNDS: [[number, number], [number, number]] = [
  [-124.41, 32.53],
  [-114.13, 42.01],
];

const fittableMap = (cameraForBounds = vi.fn(() => ({ center: [0, 0], zoom: 4 })), canvas = { clientWidth: 800, clientHeight: 600 }) => ({
  cameraForBounds,
  fitBounds: vi.fn(),
  getCanvas: () => canvas,
  once: vi.fn((_event: string, listener: () => void) => listener()),
});

describe('fitBounds', () => {
  it('should wait for the map to finish moving', async () => {
    const map = fittableMap();
    await fitBounds(map as unknown as MapLibreMap, theme, BOUNDS);

    expect(map.fitBounds).toHaveBeenCalledWith(BOUNDS, { padding: PADDING, animate: false });
    expect(map.once).toHaveBeenCalledWith('moveend', expect.any(Function));
  });

  it('should keep the theme’s gap between the bounds and the edge', async () => {
    const map = fittableMap();
    await fitBounds(map as unknown as MapLibreMap, { getPadding: () => 8 } as Theme, BOUNDS);

    expect(map.fitBounds).toHaveBeenCalledWith(BOUNDS, { padding: 8, animate: false });
  });

  it('should carry the caller’s own camera options into both the solve and the move', async () => {
    const map = fittableMap();
    await fitBounds(map as unknown as MapLibreMap, theme, BOUNDS, { maxZoom: 12 });

    expect(map.cameraForBounds).toHaveBeenCalledWith(BOUNDS, { padding: PADDING, maxZoom: 12, animate: false });
    expect(map.fitBounds).toHaveBeenCalledWith(BOUNDS, { padding: PADDING, maxZoom: 12, animate: false });
  });

  it('should give up the gap rather than the framing on a map too small for both', async () => {
    const map = fittableMap(undefined, { clientWidth: 300, clientHeight: 120 });
    await fitBounds(map as unknown as MapLibreMap, theme, BOUNDS);

    expect(map.fitBounds).toHaveBeenCalledWith(BOUNDS, { padding: 30, animate: false });
  });

  it('should ask for the whole gap on a map with room for it', async () => {
    const map = fittableMap(undefined, { clientWidth: 800, clientHeight: 400 });
    await fitBounds(map as unknown as MapLibreMap, theme, BOUNDS);

    expect(map.fitBounds).toHaveBeenCalledWith(BOUNDS, { padding: PADDING, animate: false });
  });

  it('should ask for the whole gap on a map with no box to measure', async () => {
    const map = fittableMap(undefined, { clientWidth: 0, clientHeight: 0 });
    await fitBounds(map as unknown as MapLibreMap, theme, BOUNDS);

    expect(map.fitBounds).toHaveBeenCalledWith(BOUNDS, { padding: PADDING, animate: false });
  });

  it('should leave the camera alone when there is no camera that would frame the bounds', async () => {
    const map = fittableMap(vi.fn(() => undefined) as never);
    await fitBounds(map as unknown as MapLibreMap, theme, BOUNDS);

    expect(map.fitBounds).not.toHaveBeenCalled();
  });

  it('should leave the camera alone when a globe throws over bounds it cannot frame', async () => {
    const map = fittableMap(
      vi.fn(() => {
        throw new TypeError("Cannot read properties of undefined (reading 'center')");
      }) as never,
    );

    await expect(fitBounds(map as unknown as MapLibreMap, theme, BOUNDS)).resolves.toBeUndefined();
    expect(map.fitBounds).not.toHaveBeenCalled();
  });
});

describe('openingCamera', () => {
  it('should hand the bounds and the theme’s gap to the map being built', () => {
    expect(openingCamera(container(800, 600), theme, BOUNDS)).toEqual({ bounds: BOUNDS, fitBoundsOptions: { padding: PADDING } });
  });

  it('should give up the gap rather than the framing on a container too small for both', () => {
    expect(openingCamera(container(300, 120), theme, BOUNDS)).toEqual({ bounds: BOUNDS, fitBoundsOptions: { padding: 30 } });
  });

  it('should carry the caller’s own camera options', () => {
    expect(openingCamera(container(800, 600), theme, BOUNDS, { maxZoom: 12 })).toEqual({ bounds: BOUNDS, fitBoundsOptions: { padding: PADDING, maxZoom: 12 } });
  });

  it('should ask for nothing when there is nowhere to point', () => {
    expect(openingCamera(container(800, 600), theme, undefined)).toEqual({});
  });
});

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

  deliver(times = 1) {
    for (let i = 0; i < times; i += 1) this.callback();
  }
}

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

const container = (clientWidth: number, clientHeight: number) => ({ clientWidth, clientHeight }) as HTMLElement;

const track = (element: HTMLElement) => {
  const map = resizableMap();
  trackContainerSize(map as unknown as MapLibreMap, element);
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

  it('should leave the first observation alone', () => {
    const map = resizableMap();
    trackContainerSize(map as unknown as MapLibreMap, container(800, 400));
    FakeResizeObserver.last!.deliver();

    expect(map.resize).not.toHaveBeenCalled();
  });

  it('should resize and redraw when the container changes size', () => {
    const { map, observer } = track(container(800, 400));
    observer.deliver();

    expect(map.resize).toHaveBeenCalledTimes(1);
    expect(map.redraw).toHaveBeenCalledTimes(1);
  });

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

  it('should collapse a burst of observations, ending at the last one', () => {
    const { map, observer } = track(container(800, 400));
    observer.deliver(5);

    expect(map.resize).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(50);
    expect(map.resize).toHaveBeenCalledTimes(2);

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
    expect(FakeResizeObserver.last).toBeUndefined();
  });

  it('should wait for an element with no box to be given one', async () => {
    const element = container(0, 0);
    let resolved = false;
    const sized = whenSized(element).then(() => (resolved = true));

    const observer = FakeResizeObserver.last!;
    expect(observer.observed).toEqual([element]);

    observer.deliver();
    await Promise.resolve();
    expect(resolved).toBe(false);

    Object.assign(element, { clientWidth: 800, clientHeight: 400 });
    observer.deliver();

    await expect(sized).resolves.toBe(true);
    expect(observer.disconnected).toBe(true);
  });
});

const locationTheme = { getPadding: () => 8, getOverviewPadding: () => 64 } as MapLibreTheme;

describe('frameLocation', () => {
  it('should leave the overview gap around what it frames', async () => {
    const map = fittableMap();
    await frameLocation(map as unknown as MapLibreMap, locationTheme, BOUNDS, false);

    expect(map.fitBounds).toHaveBeenCalledWith(BOUNDS, { padding: 64, animate: false });
  });

  it('should carry the caller’s own camera options', async () => {
    const map = fittableMap();
    await frameLocation(map as unknown as MapLibreMap, locationTheme, BOUNDS, false, { maxZoom: 12 });

    expect(map.fitBounds).toHaveBeenCalledWith(BOUNDS, { padding: 64, maxZoom: 12, animate: false });
  });

  it('should hold a globe camera to the half of the world it can face', async () => {
    const map = fittableMap();
    await frameLocation(map as unknown as MapLibreMap, locationTheme, WORLD, true);

    const [bounds] = map.fitBounds.mock.calls[0] as unknown as [LngLatBounds];
    expect(bounds.getEast() - bounds.getWest()).toEqual(180);
    expect(bounds.getCenter().lng).toEqual(0);
  });

  it('should point a flat map at the whole of the same area', async () => {
    const map = fittableMap();
    await frameLocation(map as unknown as MapLibreMap, locationTheme, WORLD, false);

    expect(map.fitBounds).toHaveBeenCalledWith(WORLD, { padding: 64, animate: false });
  });

  it('should leave an area a globe can face where it is', async () => {
    const map = fittableMap();
    await frameLocation(map as unknown as MapLibreMap, locationTheme, BOUNDS, true);

    const [bounds] = map.fitBounds.mock.calls[0] as unknown as [LngLatBounds];
    expect([bounds.getWest(), bounds.getEast()]).toEqual([-124.41, -114.13]);
  });
});

describe('openingLocation', () => {
  it('should open with the overview gap around what it frames', () => {
    expect(openingLocation(container(800, 600), locationTheme, BOUNDS, false)).toEqual({ bounds: BOUNDS, fitBoundsOptions: { padding: 64 } });
  });

  it('should carry the caller’s own camera options', () => {
    expect(openingLocation(container(800, 600), locationTheme, BOUNDS, false, { maxZoom: 12 })).toEqual({ bounds: BOUNDS, fitBoundsOptions: { padding: 64, maxZoom: 12 } });
  });

  it('should hold a globe camera to the half of the world it can face', () => {
    const { bounds } = openingLocation(container(800, 600), locationTheme, WORLD, true);
    const framed = bounds as LngLatBounds;

    expect(framed.getEast() - framed.getWest()).toEqual(180);
    expect(framed.getCenter().lng).toEqual(0);
  });

  it('should open a flat map on the whole of the same area', () => {
    expect(openingLocation(container(800, 600), locationTheme, WORLD, false)).toEqual({ bounds: WORLD, fitBoundsOptions: { padding: 64 } });
  });
});

const controllableMap = () => {
  const controls: { control: IControl; element: HTMLElement }[] = [];
  const pending: Record<string, (() => void)[]> = {};

  return {
    controls,
    addControl(control: IControl) {
      controls.push({ control, element: control.onAdd(this as unknown as MapLibreMap) });
    },
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

describe('readProjection', () => {
  const inProjection = (type: string | undefined) => ({ getProjection: () => (type === undefined ? undefined : { type }) }) as unknown as MapLibreMap;

  it('should read a flat map as flat', () => {
    expect(readProjection(inProjection('mercator'))).toEqual('mercator');
  });

  it('should read either kind of sphere as a globe', () => {
    expect(readProjection(inProjection('globe'))).toEqual('globe');
    expect(readProjection(inProjection('vertical-perspective'))).toEqual('globe');
  });

  it('should answer with nothing before a style has arrived', () => {
    expect(readProjection(inProjection(undefined))).toBeUndefined();
  });
});

describe('disableRotation', () => {
  it('should turn off the two gestures a map option cannot name', () => {
    const map = controllableMap();
    disableRotation(map as unknown as MapLibreMap);

    expect(map.keyboard.disableRotation).toHaveBeenCalled();
    expect(map.touchZoomRotate.disableRotation).toHaveBeenCalled();
  });
});

describe('addLocationControls', () => {
  it('should offer zoom buttons and no compass', () => {
    const map = controllableMap();
    addLocationControls(map as unknown as MapLibreMap);

    const { element } = map.controls[0];
    expect(Array.from(element.querySelectorAll('button'), button => button.className)).toEqual(['maplibregl-ctrl-zoom-in', 'maplibregl-ctrl-zoom-out']);
    expect(element.querySelector('.maplibregl-ctrl-compass')).toBeNull();
  });

  it('should wait for a style document before offering the projection toggle', () => {
    const map = controllableMap();
    addLocationControls(map as unknown as MapLibreMap);

    expect(map.controls).toHaveLength(1);

    map.fire('style.load');

    expect(map.controls).toHaveLength(2);
    expect(map.controls[1].element.querySelector('[class^="maplibregl-ctrl-globe"]')).toBeTruthy();
  });

  it('should offer the projection toggle once, however many styles arrive', () => {
    const map = controllableMap();
    addLocationControls(map as unknown as MapLibreMap);
    map.fire('style.load');
    map.fire('style.load');

    expect(map.controls).toHaveLength(2);
  });
});
