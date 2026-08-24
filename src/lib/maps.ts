import maplibregl from 'maplibre-gl';

import { clampToHemisphere } from './geometry';
import type { MapProjection } from './previewers/map';
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
    // The basemaps are CARTO's, over OpenStreetMap data; both require attribution. Compact so that
    // the panel can be put away, which is all an embedded map has room for - though MapLibre still
    // opens it once there is something to credit, and only closes it when the reader drags the map.
    // A caller that can't spare the corner at all hands over `attributionControl: false` and adds
    // our own instead; see AttributionControl.
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
/**
 * Which projection a map is in, or nothing at all before it has a style document to carry one.
 *
 * MapLibre has two names for a sphere: 'globe' draws as one until it is zoomed in far enough that a
 * sphere and a flat map are the same picture, and 'vertical-perspective' stays one throughout. Either
 * is a globe as far as a camera is concerned - see frameLocation - so either comes back as one.
 *
 * Asked of the map rather than remembered, because the map is the one that knows: a projection can
 * change without anything here having asked for it. A style document names its own, and applying one
 * announces the change as the same event a reader pressing the globe button does.
 */
export const readProjection = (map: maplibregl.Map): MapProjection | undefined => {
  const type = map.getProjection()?.type;
  if (type === undefined) return undefined;

  return type === 'mercator' ? 'mercator' : 'globe';
};

export const setBasemap = async (map: maplibregl.Map, theme: MapLibreTheme): Promise<void> =>
  new Promise<void>(resolve => {
    map.once('style.load', () => resolve());
    map.setStyle(theme.getBaseMapStyle());
  });

/**
 * Where to open a map, for a caller that already knows where its map is going.
 *
 * MapLibre reads `bounds` in place of the center and zoom createMap opens on, and points the camera
 * there inside the constructor, before there is a frame for anyone to see. Nothing else here can be
 * that early: a preview is fitted once it has drawn and a location once its style document is up, and
 * until whichever it waits on lands, a map that could have opened on its record is showing the whole
 * world instead. The camera that follows still runs - what a record declares isn't always the whole
 * of what a resource turns out to cover - but it moves from one view of the record to another rather
 * than in from the world.
 *
 * The gap is measured against the container, because there is no canvas to measure yet: it is the same
 * box either way, and MapLibre resizes to it before it fits anything. Nothing of ours holds the camera
 * still, either - MapLibre hands this one its own `duration: 0`.
 *
 * Nothing at all for a caller with nowhere to point, which leaves createMap's own view where it is.
 */
export const openingCamera = (container: HTMLElement, theme: Theme, target: maplibregl.LngLatBoundsLike | undefined, extras: maplibregl.FitBoundsOptions = {}): MapExtras => {
  if (!target) return {};

  const fitBoundsOptions: maplibregl.FitBoundsOptions = { padding: theme.getPadding(), ...extras };
  fitBoundsOptions.padding = fittablePadding(container, fitBoundsOptions.padding);
  return { bounds: target, fitBoundsOptions };
};

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
  const options: maplibregl.FitBoundsOptions = { padding: theme.getPadding(), animate: false, ...extras };
  options.padding = fittablePadding(map.getCanvas(), options.padding);
  if (!cameraForBounds(map, bounds, options)) return;
  return new Promise<void>(resolve => {
    map.once('moveend', () => resolve());
    map.fitBounds(bounds, options);
  });
};

// The gap asked for, held to what the box it has to fit inside can actually spare - a map's canvas,
// or the container a map is about to be built in; see openingCamera, which has no canvas to ask yet.
//
// MapLibre has no camera for bounds it can't fit the padding inside - the width left over goes
// negative and cameraForBounds hands back nothing - and the guard below reads that as "leave the
// camera alone". So a pane shorter than twice the gap keeps whatever view it opened on, with what it
// was pointed at somewhere off screen, and nothing anywhere says so. An overview's gap is 64, which
// makes that any pane under 128 pixels: a locator beside a record's metadata, a map in a list.
// The gap is the thing that should give way there, not the framing.
//
// Only a plain number is held down. `padding` can also name the four edges one at a time, and nothing
// here does that - what a sidebar covers is set on the map rather than asked of one camera.
const fittablePadding = (box: { clientWidth: number; clientHeight: number }, padding: maplibregl.FitBoundsOptions['padding']): maplibregl.FitBoundsOptions['padding'] => {
  if (typeof padding !== 'number') return padding;

  // A map inside something hidden measures zero, and zero is not a small map: it is a map nobody can
  // see. Held to what it measures, it would frame whatever it was pointed at with no gap at all, and
  // that camera is the one still on screen when the pane is shown again.
  const shortest = Math.min(box.clientWidth, box.clientHeight);
  if (!shortest) return padding;

  return Math.min(padding, Math.floor(shortest / 4));
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

/**
 * What a map that says where records are is allowed to do.
 *
 * Both of them take exactly this - a locator's one record and an overview's several - so a reader can
 * pan and zoom and nothing else. These maps are read at a glance, and one that has been turned or
 * tilted can't be compared with the next one, so neither is offered. Cooperative gestures because a
 * small map inside a page must not eat the page's scroll, which is also why both of them carry zoom
 * buttons: a wheel needs the command key once this is on. And below createMap's own floor of 2,
 * because one record can cover the world, and an extent that wide framed with a gap around it inside
 * a container this small wants a camera further out than a map of data ever does.
 */
export const LOCATION_MAP: MapExtras = {
  cooperativeGestures: true,
  dragRotate: false,
  touchPitch: false,
  minZoom: 1,
};

// MapLibre's two remaining ways to turn a map, neither of which LOCATION_MAP covers because neither
// is an option a map option can name: `dragRotate: false` takes the ctrl-drag bearing and the
// right-drag pitch with it and leaves the keyboard's shift+arrows and the two-finger pinch-rotate
// alone. With these there is no gesture, key or control left that can produce a bearing or a pitch -
// which is also why the navigation control below has no compass, since there would be nothing for it
// to reset. setMaxPitch(0) would be a knob with nothing behind it; that one is <ogm-map>'s, where a
// previewer names the limit.
export const disableRotation = (map: maplibregl.Map) => {
  map.keyboard.disableRotation();
  map.touchZoomRotate.disableRotation();
};

/**
 * Zoom buttons and the projection toggle, ordered from the top down.
 *
 * MapLibre's own globe control rather than ours: GlobeControl here exists to take itself off the map
 * for a preview that can only be drawn flat, and a location can be drawn on anything.
 *
 * The globe button waits for a style document; the zoom buttons don't need one. Its click reaches
 * Style.setProjection, which opens by checking that a style has loaded and throws when one hasn't -
 * and on a map this small the window between building it and CARTO's style landing is easy to click
 * in. Waiting also means the button reads the projection we set rather than the one a styleless map
 * reports, so it opens showing the state it is actually in.
 */
export const addLocationControls = (map: maplibregl.Map) => {
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }));
  map.once('style.load', () => map.addControl(new maplibregl.GlobeControl()));
};

// How close either of these maps opens, whatever it was pointed at. Past city scale a basemap may
// have nothing named left to place a shape against, and a shape that can't be placed is a location
// nobody can read. It is also the only thing between a record whose location is a single point and a
// camera at street level: a point is a box with no width, so the fit has nothing to divide by and
// settles for whatever ceiling it was given - which, unasked, is the map's own maxZoom of 22.
export const LOCATION_MAX_ZOOM = 12;

/**
 * Point the camera at an area, holding it to what the projection the map is in can face.
 *
 * A globe camera has no answer for a box wider than the half of the world facing it: the solve takes
 * the flat answer and shrinks the globe until the box fits in front of it, and past 180 degrees no
 * size does, so MapLibre warns and hands back nothing and the camera stays where it was. Half of a
 * wide area is worth more than none of it, and the projection button is right there for a reader who
 * wants the whole of it. A flat map has no such limit and gets what it was given.
 *
 * The theme's overview gap either way, rather than the one a preview gets: these are whole maps read
 * at once rather than a pane filled with one record, and a shape drawn against the edge reads as
 * running off it - on a globe, that edge is where the sphere turns away.
 */
export const frameLocation = async (
  map: maplibregl.Map,
  theme: MapLibreTheme,
  target: maplibregl.LngLatBoundsLike,
  globe: boolean,
  extras: maplibregl.FitBoundsOptions = {},
): Promise<void> => fitBounds(map, theme, globe ? clampToHemisphere(target) : target, { padding: theme.getOverviewPadding(), ...extras });

/**
 * Where to open a map that says where records are: the camera frameLocation would settle on, worked
 * out before there is a map to ask for one.
 *
 * The same overview gap, and the same holding to what a globe can face - because that is the
 * projection these maps open in, and a wide record framed as though it were flat would be re-framed
 * the moment the style document lands, which is the jump this exists to avoid.
 */
export const openingLocation = (
  container: HTMLElement,
  theme: MapLibreTheme,
  target: maplibregl.LngLatBoundsLike,
  globe: boolean,
  extras: maplibregl.FitBoundsOptions = {},
): MapExtras => openingCamera(container, theme, globe ? clampToHemisphere(target) : target, { padding: theme.getOverviewPadding(), ...extras });
