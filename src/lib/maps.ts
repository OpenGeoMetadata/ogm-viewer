import maplibregl from 'maplibre-gl';

import type Theme from './themes/theme';
import type MapLibreTheme from './themes/maplibre';

// What a caller decides for itself. Everything a map of ours has in common is below; this is the
// rest - gestures, request transforms, whether the thing can be dragged at all. The container and
// the basemap aren't offered, because those are the two nothing should be able to disagree about.
export type MapExtras = Omit<Partial<maplibregl.MapOptions>, 'container' | 'style'>;

/**
 * A map with our basemap on it, pointed at the whole world until something says otherwise.
 *
 * Two components build one now - <ogm-map> and <ogm-overview> - and Stencil components can't
 * inherit from each other, so what they share is a function rather than a base class. Only the
 * decisions that would be wrong to make twice: which basemap, that the attribution is on and
 * compact, and where the camera starts.
 */
export const createMap = (container: HTMLElement, theme: MapLibreTheme, extras: MapExtras = {}): maplibregl.Map =>
  new maplibregl.Map({
    container,
    // The basemaps are CARTO's, over OpenStreetMap data; both require attribution. Compact so it
    // is a single "i" in the corner until clicked, which is all an embedded map has room for.
    attributionControl: { compact: true },
    style: theme.getBaseMapStyle(),
    center: [0, 0],
    zoom: 2,
    minZoom: 2,
    ...extras,
  });

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
