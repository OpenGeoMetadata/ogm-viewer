import {
  GlobeControl,
  MapLibreMap,
  NavigationControl,
  setWorkerUrl,
  type CameraForBoundsOptions,
  type FitBoundsOptions,
  type LngLatBoundsLike,
  type MapOptions,
} from 'maplibre-gl';

import { clampToHemisphere } from './geometry';
import { MAPLIBRE_WORKER_SOURCE } from './maplibre-worker-source';
import type { MapProjection } from './previewers/map';
import type Theme from './themes/theme';
import type MapLibreTheme from './themes/maplibre';

export type MapExtras = Omit<Partial<MapOptions>, 'container' | 'style' | 'trackResize'>;

const RESIZE_PERIOD = 50;

let workerUrl: string | undefined;

// Inline the worker to avoid missing sibling files and cross-origin worker URLs in consuming apps.
const useBundledWorker = () => {
  if (workerUrl || !MAPLIBRE_WORKER_SOURCE) return;

  workerUrl = URL.createObjectURL(new Blob([MAPLIBRE_WORKER_SOURCE], { type: 'text/javascript' }));
  setWorkerUrl(workerUrl);
};

export const createMap = (container: HTMLElement, theme: MapLibreTheme, extras: MapExtras = {}): MapLibreMap => {
  useBundledWorker();

  const map = new MapLibreMap({
    container,
    attributionControl: { compact: true },
    style: theme.getBaseMapStyle(),
    center: [0, 0],
    zoom: 2,
    minZoom: 2,
    ...extras,
    trackResize: false,
  });
  trackContainerSize(map, container);
  return map;
};

// Ignore zero-size containers so hidden tabs do not corrupt the camera fit.
export const trackContainerSize = (map: MapLibreMap, container: HTMLElement) => {
  const resize = throttle(() => {
    map.resize();
    map.redraw();
  }, RESIZE_PERIOD);

  let firstObservation = true;
  const observer = new ResizeObserver(() => {
    if (firstObservation) {
      firstObservation = false;
      return;
    }

    if (!container.clientWidth || !container.clientHeight) return;
    resize();
  });

  observer.observe(container);
  map.once('remove', () => observer.disconnect());
};

// Wait for a measurable box before MapLibre chooses its initial camera.
export const whenSized = (element: HTMLElement): Promise<void> =>
  new Promise(resolve => {
    if (element.clientWidth && element.clientHeight) return resolve();

    const observer = new ResizeObserver(() => {
      if (!element.clientWidth || !element.clientHeight) return;
      observer.disconnect();
      resolve();
    });
    observer.observe(element);
  });

const throttle = (fn: () => void, period: number): (() => void) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let skipped = false;

  const run = () => {
    fn();
    timer = setTimeout(() => {
      timer = undefined;
      if (!skipped) return;
      skipped = false;
      run();
    }, period);
  };

  return () => {
    if (timer) skipped = true;
    else run();
  };
};

// Treat both globe and vertical-perspective as spherical when fitting a camera.
export const readProjection = (map: MapLibreMap): MapProjection | undefined => {
  const type = map.getProjection()?.type;
  if (type === undefined) return undefined;

  return type === 'mercator' ? 'mercator' : 'globe';
};

export const setBasemap = async (map: MapLibreMap, theme: MapLibreTheme): Promise<void> =>
  new Promise<void>(resolve => {
    map.once('style.load', () => resolve());
    map.setStyle(theme.getBaseMapStyle());
  });

export const openingCamera = (container: HTMLElement, theme: Theme, target: LngLatBoundsLike | undefined, extras: FitBoundsOptions = {}): MapExtras => {
  if (!target) return {};

  const fitBoundsOptions: FitBoundsOptions = { padding: theme.getPadding(), ...extras };
  fitBoundsOptions.padding = fittablePadding(container, fitBoundsOptions.padding);
  return { bounds: target, fitBoundsOptions };
};

export const fitBounds = async (map: MapLibreMap, theme: Theme, bounds: LngLatBoundsLike, extras: FitBoundsOptions = {}): Promise<void> => {
  const options: FitBoundsOptions = { padding: theme.getPadding(), animate: false, ...extras };
  options.padding = fittablePadding(map.getCanvas(), options.padding);
  if (!cameraForBounds(map, bounds, options)) return;
  return new Promise<void>(resolve => {
    map.once('moveend', () => resolve());
    map.fitBounds(bounds, options);
  });
};

// Clamp padding to leave drawable space even in a very small container.
const fittablePadding = (box: { clientWidth: number; clientHeight: number }, padding: FitBoundsOptions['padding']): FitBoundsOptions['padding'] => {
  if (typeof padding !== 'number') return padding;

  // A hidden map has no useful size; leave its requested padding intact until it becomes visible.
  const shortest = Math.min(box.clientWidth, box.clientHeight);
  if (!shortest) return padding;

  return Math.min(padding, Math.floor(shortest / 4));
};

const cameraForBounds = (map: MapLibreMap, bounds: LngLatBoundsLike, options: CameraForBoundsOptions) => {
  try {
    return map.cameraForBounds(bounds, options);
  } catch {
    return undefined;
  }
};

export const zoomToFit = (map: MapLibreMap, bounds: LngLatBoundsLike): number | undefined => cameraForBounds(map, bounds, {})?.zoom;

export const LOCATION_MAP: MapExtras = {
  dragRotate: false,
  touchPitch: false,
  minZoom: 1,
};

// Disabling drag rotation alone still permits rotation through touch and keyboard handlers.
export const disableRotation = (map: MapLibreMap) => {
  map.keyboard.disableRotation();
  map.touchZoomRotate.disableRotation();
};

export const addLocationControls = (map: MapLibreMap) => {
  map.addControl(new NavigationControl({ showCompass: false }));
  map.once('style.load', () => map.addControl(new GlobeControl()));
};

export const LOCATION_MAX_ZOOM = 12;

// A globe cannot fit more than a hemisphere; clamp wide extents before asking MapLibre to frame them.
export const frameLocation = async (map: MapLibreMap, theme: MapLibreTheme, target: LngLatBoundsLike, globe: boolean, extras: FitBoundsOptions = {}): Promise<void> =>
  fitBounds(map, theme, globe ? clampToHemisphere(target) : target, { padding: theme.getOverviewPadding(), ...extras });

export const openingLocation = (container: HTMLElement, theme: MapLibreTheme, target: LngLatBoundsLike, globe: boolean, extras: FitBoundsOptions = {}): MapExtras =>
  openingCamera(container, theme, globe ? clampToHemisphere(target) : target, { padding: theme.getOverviewPadding(), ...extras });
