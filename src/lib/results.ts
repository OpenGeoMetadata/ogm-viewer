import { LngLatBounds, type LngLatBoundsLike, type Map, type SymbolLayerSpecification } from 'maplibre-gl';

import type { MapLibreStyle } from './themes/maplibre';

// The one source and the one layer that carry the result numbers. Not derived from anything: there
// is exactly one set of them on a map, however many records are drawn on it.
export const RESULT_NUMBERS = 'ogm-result-numbers';

// How much bigger a result's number is drawn than a label on a feature. Deliberately not themed,
// for the reason LocationPreviewer's FILL_OPACITY isn't: this is the relationship between a number
// read against a whole globe and the text drawn beside a feature, not a value an embedding app has
// a reason to name. Setting --ogm-text-size still moves both together.
const NUMBER_SIZE = 1.5;

/**
 * One numbered point per extent, in the order the extents were given.
 *
 * A record nobody could place spends its number rather than passing it on. The number is where the
 * record sits in the list of results being read beside the map, so closing the gap left by a record
 * with no bounding box would point every result after it at the wrong row.
 *
 * A point of our own rather than a label on the box itself, for a reason that only shows up at
 * size: MapLibre places a polygon's label at the pole of inaccessibility of each tile the polygon
 * touches, and with collision turned off below there is nothing left to suppress the copies. A
 * country-sized box would wear its number three or four times.
 */
export const numberedResults = (extents: (LngLatBoundsLike | undefined)[]): GeoJSON.FeatureCollection<GeoJSON.Point> => ({
  type: 'FeatureCollection',
  features: extents.flatMap((extent, index) => {
    if (!extent) return [];
    // getCenter() averages the corners as they were written, so a box carrying its east edge past
    // 180 - see unwrapEast - is centered on the Pacific rather than on Greenwich. MapLibre reads a
    // longitude from outside -180..180 everywhere it takes one, so there is nothing to wrap back.
    const { lng, lat } = LngLatBounds.convert(extent).getCenter();
    return [{ type: 'Feature' as const, properties: { label: String(index + 1) }, geometry: { type: 'Point' as const, coordinates: [lng, lat] } }];
  }),
});

// Drawn in the theme's text, and never dropped. A number that isn't there is worse than one that
// overlaps: the list beside the map is counting on every one of them being findable. Allowing
// overlap keeps this layer's numbers from being culled by the ones already placed; ignoring
// placement keeps them from culling each other.
export const resultNumbersLayer = (style: MapLibreStyle): SymbolLayerSpecification => ({
  id: RESULT_NUMBERS,
  type: 'symbol' as const,
  source: RESULT_NUMBERS,
  layout: {
    'visibility': 'visible' as const,
    'text-field': ['get', 'label'] as const,
    'text-font': [style.textFont],
    'text-size': style.textSize * NUMBER_SIZE,
    'text-allow-overlap': true,
    'text-ignore-placement': true,
  },
  paint: {
    'text-color': style.textColor,
    'text-halo-color': style.textHaloColor,
    // Twice the halo a feature label gets. These are read against whatever box, wash and basemap
    // happen to be underneath, at a size where a single pixel of outline disappears.
    'text-halo-width': 2,
  },
});

// Put the numbers on the map, above everything already drawn there. Taken off and put back rather
// than updated in place, because addLayer appends: adding the layer again after the boxes have been
// redrawn is what keeps every number over every box, whatever order the boxes arrived in.
export const drawResultNumbers = (map: Map, style: MapLibreStyle, extents: (LngLatBoundsLike | undefined)[]) => {
  clearResultNumbers(map);
  map.addSource(RESULT_NUMBERS, { type: 'geojson', data: numberedResults(extents) });
  map.addLayer(resultNumbersLayer(style));
};

// Take the numbers back off. Guarded both ways: a theme swap empties the style document without
// asking, so the layer this last drew may already be gone.
export const clearResultNumbers = (map: Map) => {
  if (map.getLayer(RESULT_NUMBERS)) map.removeLayer(RESULT_NUMBERS);
  if (map.getSource(RESULT_NUMBERS)) map.removeSource(RESULT_NUMBERS);
};
