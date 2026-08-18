import maplibregl from 'maplibre-gl';

import type Theme from './themes/theme';
import type MapLibreTheme from './themes/maplibre';

// What a caller decides for itself. Everything a map of ours has in common is below; this is the
// rest - gestures, request transforms, whether the thing can be dragged at all. The container, the
// basemap and the resize tracking aren't offered, because those are the three nothing should be
// able to disagree about.
export type MapExtras = Omit<Partial<maplibregl.MapOptions>, 'container' | 'style' | 'trackResize'>;

// How long to leave between resizes while a container is still on its way to a new size. MapLibre's
// own tracking waits this long, and reallocating a drawing buffer costs the same either way.
const RESIZE_PERIOD = 50;

/**
 * A map with our basemap on it, pointed at the whole world until something says otherwise.
 */
export const createMap = (container: HTMLElement, theme: MapLibreTheme, extras: MapExtras = {}): maplibregl.Map => {
  const map = new maplibregl.Map({
    container,
    // The basemaps are CARTO's, over OpenStreetMap data; both require attribution. Compact so it
    // is a single "i" in the corner until clicked, which is all an embedded map has room for.
    attributionControl: { compact: true },
    style: theme.getBaseMapStyle(),
    center: [0, 0],
    zoom: 2,
    minZoom: 2,
    ...extras,
    // Ours to do instead; see trackContainerSize. After the spread so it can't be handed back.
    trackResize: false,
  });

  trackContainerSize(map, container);
  return map;
};

/**
 * Keep the map at the size of its container, leaving alone a container that has no size at all.
 *
 * This is MapLibre's own trackResize minus the one case that goes wrong for us, which is why
 * createMap turns theirs off in favour of it. Their _containerDimensions() reads `clientWidth || 400`,
 * so a container with no box - a map inside a `display: none` subtree, an inactive <wa-tab-panel>, a
 * pane an embedding page has hidden - is read as a 400x300 one, and the canvas is resized to match.
 *
 * MapLibre puts that right the moment the container is back, but by then something else may have
 * copied it. deck.gl's overlay draws into this same canvas and syncs its own drawing buffer from
 * whatever size it finds there: hidden, it finds the 400x300 one, and its first frame after the map
 * is shown again stamps that back over the size MapLibre has just corrected. The canvas then holds a
 * buffer of one size stretched across a box of another, which is what drew every COG preview skewed
 * after a trip through the overview. Nothing resizes the container a second time, so nothing puts it
 * right either.
 */
export const trackContainerSize = (map: maplibregl.Map, container: HTMLElement) => {
  const resize = throttle(() => {
    map.resize();
    map.redraw();
  }, RESIZE_PERIOD);

  let firstObservation = true;
  const observer = new ResizeObserver(() => {
    // The size the map was just built at, rather than a change to it. MapLibre skips this one too,
    // and resizing here would stop the camera that is opening the preview partway through.
    if (firstObservation) {
      firstObservation = false;
      return;
    }

    if (!container.clientWidth || !container.clientHeight) return;
    resize();
  });

  observer.observe(container);
  // The map disconnects its own observer as it goes; this one goes with it
  map.once('remove', () => observer.disconnect());
};

/**
 * Resolve once the element has a box to be measured - which, for one that already has, is now.
 *
 * The other half of trackContainerSize. MapLibre reads a container with no box as a 400x300 one when
 * it is built as well, and that happens in the constructor, before there is any observer of ours to
 * skip it. Resizing afterwards isn't enough to undo: deck.gl's overlay copies its drawing buffer from
 * the canvas as it attaches, so a map built into a hidden container hands it a size that was never
 * real, and it stamps that back the first time it draws. Building nothing until there is something to
 * build into is what closes that, and a hidden map has nothing to show in the meantime anyway.
 */
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

// Run straight away, then no more often than every `period` milliseconds, with a last run once the
// calls stop - so the size that gets skipped is never the size it ended at.
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

/**
 * Swap the basemap for the one the theme now asks for; resolve once the new style document is up.
 *
 * Whatever was drawn on the old one has to be drawn again by the caller: setStyle empties the style
 * document and takes every source and layer on it away. The listener goes on before the swap rather
 * than after, so a style that loads from cache can't be up before anyone is listening for it.
 */
export const setBasemap = async (map: maplibregl.Map, theme: MapLibreTheme): Promise<void> =>
  new Promise<void>(resolve => {
    map.once('style.load', () => resolve());
    map.setStyle(theme.getBaseMapStyle());
  });

/**
 * Point the map at the given bounds; resolve once it has finished moving.
 *
 * The theme's gap, on all four edges, so what's drawn reads as having edges instead of running off
 * the canvas. Only the theme's: what a sidebar covers is the map's own padding, and MapLibre already
 * takes that off the space it fits bounds into. `extras` is anything else the caller wants of this
 * one camera - a maxZoom, say - as against the limits it set on the map itself, which apply to every
 * camera including the ones a reader drives.
 */
export const fitBounds = async (map: maplibregl.Map, theme: Theme, bounds: maplibregl.LngLatBoundsLike, extras: maplibregl.FitBoundsOptions = {}): Promise<void> => {
  const options = { padding: theme.getPadding(), ...extras };
  if (!cameraForBounds(map, bounds, options)) return;
  return new Promise<void>(resolve => {
    map.once('moveend', () => resolve());
    map.fitBounds(bounds, options);
  });
};

// Whether there is a camera that would frame these bounds at all - there isn't, if the padding
// asked for is wider than the canvas it has to fit inside. MapLibre says so by handing back
// undefined on a flat map, but on a globe it reads that undefined itself and throws: the globe
// solve takes the flat answer and only corrects its zoom. The same non-answer either way.
const cameraForBounds = (map: maplibregl.Map, bounds: maplibregl.LngLatBoundsLike, options: maplibregl.CameraForBoundsOptions) => {
  try {
    return map.cameraForBounds(bounds, options);
  } catch {
    return undefined;
  }
};
