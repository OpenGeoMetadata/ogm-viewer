import {
  LngLatBounds,
  type CircleLayerSpecification,
  type DataDrivenPropertyValueSpecification,
  type ExpressionSpecification,
  type FillLayerSpecification,
  type FilterSpecification,
  type LineLayerSpecification,
  type LngLatBoundsLike,
  type Map,
  type SymbolLayerSpecification,
} from 'maplibre-gl';

import { boundsToGeoJSON } from './geometry';
import { FILL_OPACITY } from './previewers/location';
import { contrastColor } from './themes/color';
import type { MapLibreStyle } from './themes/maplibre';

// The one source that carries the result numbers, and the two pairs of layers that draw them: the
// results as they were given, and the one something outside has asked to highlight. Not derived from
// anything - there is exactly one set of these on a map, however many results are drawn on it.
export const RESULT_NUMBERS = 'ogm-result-numbers';
export const RESULT_HIGHLIGHT = `${RESULT_NUMBERS}-highlight`;

// The two boxes drawn under the numbers: the area a search is filtered to, and the extent of the
// highlighted result. A source each rather than two features of one, because they are two different
// statements about the map, drawn in different colors, arriving at different times.
export const SEARCH_BOUNDS = 'ogm-search-bounds';
export const HIGHLIGHT_BOUNDS = 'ogm-highlight-bounds';

// How much bigger a result's number is drawn than a label on a feature. Deliberately not themed,
// for the reason LocationPreviewer's FILL_OPACITY isn't: this is the relationship between a number
// read against a whole globe and the text drawn beside a feature, not a value an embedding app has
// a reason to name. Setting --ogm-text-size still moves both together.
//
// It is also all the weight a number gets. `text-font` names a fontstack the basemap's own glyph
// endpoint has to serve rather than a CSS font stack, so there is no Bold to ask for: a stack CARTO
// doesn't serve draws nothing at all. The size, the disc under it and the halo are what make these
// read as bold.
const NUMBER_SIZE = 1.5;

// How wide the disc behind a number is, as a multiple of the number's own size: room for one digit,
// then for two, then for anything longer. Stepped rather than grown smoothly with the label, because
// a page of eight results would otherwise wear eight slightly different discs and read as eight
// different kinds of thing. Not themed, for the same reason NUMBER_SIZE isn't.
const NUMBER_RADIUS = [0.7, 0.9, 1.15];

// The ring around a disc and the edge on the numeral inside it, in pixels. The same two the rest of
// the library draws with: a location's outline is 2 and a feature label's halo is 1. The ring is what
// holds a disc apart from the basemap and from the disc beside it, which is the halo's job done for
// a shape.
const NUMBER_STROKE = 2;
const NUMBER_HALO = 1;

// How much room each number clears around itself, in pixels; MapLibre's own default is 2. Nothing
// culls one of ours - see resultNumbersLayers - so this only ever pushes the basemap's own labels out
// from under them, which is the one kind of overlap here worth spending anything on.
//
// Roughly the difference between the numeral and the disc it sits on, because the box this pads is the
// numeral's: the disc is a circle layer, and circles take no part in the collision grid at all. At
// MapLibre's default of 2 a basemap label could sit under the disc's own rim while clearing the digits
// inside it, which reads as a label with a marker dropped on it.
const NUMBER_PADDING = 8;

// Everything an overview draws, gathered in one place because the order it goes onto the map in is
// most of what keeps it readable.
export type DrawnResults = {
  // Where every result is, in the order they were given, including the ones nobody could place
  extents: (LngLatBoundsLike | undefined)[];
  // Which of those results is highlighted, as its place in that list counted from one
  highlighted?: number;
  // The area a search is currently filtered to, if one is
  searchBounds?: LngLatBounds;
};

// What a box is drawn in. The two of them differ in nothing else, so this is the whole of the
// difference between the area being searched and the extent of the highlighted result.
type BoxColors = { color: string; strokeColor: string; opacity: number };

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
export const numberedResults = (extents: (LngLatBoundsLike | undefined)[], highlighted?: number): GeoJSON.FeatureCollection<GeoJSON.Point> => ({
  type: 'FeatureCollection',
  features: extents.flatMap((extent, index) => {
    if (!extent) return [];
    // getCenter() averages the corners as they were written, so a box carrying its east edge past
    // 180 - see unwrapEast - is centered on the Pacific rather than on Greenwich. MapLibre reads a
    // longitude from outside -180..180 everywhere it takes one, so there is nothing to wrap back.
    const { lng, lat } = LngLatBounds.convert(extent).getCenter();
    return [
      {
        type: 'Feature' as const,
        // Marked on every point rather than only on the one that has it. Two pairs of layers select
        // on this from opposite sides, and a filter that reads as a plain comparison against
        // something every feature carries is worth the two bytes it costs.
        properties: { label: String(index + 1), highlighted: index + 1 === highlighted },
        geometry: { type: 'Point' as const, coordinates: [lng, lat] },
      },
    ];
  }),
});

/**
 * A disc with a numeral on it, in the two style layers it takes to draw one.
 *
 * A symbol layer has no background to put behind its text, so the disc is a circle layer of its own
 * underneath, reading the same source. Two of these pairs go on a map, selecting on the same property
 * from opposite sides, and the highlighted one goes on last. A `case` expression in each paint
 * property would color the highlighted marker in place, but it could not lift it: a symbol layer
 * draws all of its text after all of its icons, and layers draw in the order they were added, so
 * within one pair there is no arrangement that puts one feature's disc and its number together above
 * its neighbours'. Only a later pair does that.
 *
 * Neither pair is ever culled. A number that isn't there is worse than one that overlaps, because the
 * list beside the map is counting on every one of them being findable. What is deliberately not asked
 * for is `text-ignore-placement`: keeping our numbers out of the collision grid would leave the
 * basemap's own labels free to draw underneath them, which is the most cluttered thing they could sit
 * on. In the grid, a basemap label that collides with a number is dropped instead - and ours still
 * can't be dropped, because allowing overlap skips the hit test for them entirely and placement runs
 * from the top layer down, so these are placed before anything the basemap wanted that space for.
 */
export const resultNumbersLayers = (style: MapLibreStyle, highlighted: boolean = false): [CircleLayerSpecification, SymbolLayerSpecification] => {
  const id = highlighted ? RESULT_HIGHLIGHT : RESULT_NUMBERS;
  const color = highlighted ? style.markerHighlightColor : style.markerColor;
  const filter: FilterSpecification = highlighted ? ['==', ['get', 'highlighted'], true] : ['!=', ['get', 'highlighted'], true];
  const size = style.textSize * NUMBER_SIZE;

  // Earlier results on top, so counting down the list beside the map is counting away from the
  // reader: the first result is the one a page put first, and it stays over the twentieth however the
  // map is panned. Both properties draw a higher key over a lower one, so the key is the number
  // negated. Without one at all, MapLibre orders symbols by where they land on screen, and they
  // restack as the map moves - which reads as the numbers rearranging themselves.
  const sortKey: ExpressionSpecification = ['-', 0, ['to-number', ['get', 'label']]];

  // Room for the digits, in the three sizes a page of results can need
  const radius: DataDrivenPropertyValueSpecification<number> = [
    'step',
    ['length', ['get', 'label']],
    size * NUMBER_RADIUS[0],
    2,
    size * NUMBER_RADIUS[1],
    3,
    size * NUMBER_RADIUS[2],
  ];

  return [
    {
      id: `${id}-circle`,
      type: 'circle' as const,
      source: RESULT_NUMBERS,
      filter,
      layout: {
        'visibility': 'visible' as const,
        'circle-sort-key': sortKey,
      },
      paint: {
        'circle-color': color,
        'circle-radius': radius,
        // The ink the numeral is drawn in, so a disc reads as one shape with a rim rather than as a
        // disc with a halo of its own. One color that holds up on either basemap, and the thing that
        // keeps two overlapping discs from reading as one.
        'circle-stroke-color': contrastColor(color) || style.textHaloColor,
        'circle-stroke-width': NUMBER_STROKE,
        // No opacity asked for, here or on the numbers. Everything else this map draws is a note
        // about where to look and starts faint so the basemap can be read through it; a number is
        // the thing being read, and there is nothing under it worth seeing.
      },
    },
    {
      id: `${id}-label`,
      type: 'symbol' as const,
      source: RESULT_NUMBERS,
      filter,
      layout: {
        'visibility': 'visible' as const,
        'text-field': ['get', 'label'] as const,
        'text-font': [style.textFont],
        'text-size': size,
        'text-allow-overlap': true,
        'text-padding': NUMBER_PADDING,
        'symbol-sort-key': sortKey,
      },
      paint: {
        // Whichever of black and white can be read on the disc, rather than the theme's own text
        // color, which is near-black in light mode and would disappear into it. The disc is derived
        // to a depth that makes this white; see MapLibreTheme.markerColor.
        'text-color': contrastColor(color) || style.textHaloColor,
        // The disc's own color, not the theme's halo: on a disc there is nothing left for white to
        // hold the numeral apart from, and an edge in the disc's color is what keeps a numeral from
        // touching the ring around it.
        'text-halo-color': color,
        'text-halo-width': NUMBER_HALO,
      },
    },
  ];
};

// A box, drawn the way LocationPreviewer draws a record's extent: a thin outline with a wash inside
// it, the wash held below the outline at every setting. Drawn from here rather than by that previewer
// because neither of these is a preview - there is no tab to name, no row for the layer panel, no
// opacity for a reader to drag and nothing to inspect - and because what keeps all of this readable
// is the order it goes on in, which is easier to see written out once.
const boundsLayers = (id: string, { color, strokeColor, opacity }: BoxColors): [FillLayerSpecification, LineLayerSpecification] => [
  {
    id: `${id}-fill`,
    type: 'fill' as const,
    source: id,
    layout: { visibility: 'visible' as const },
    paint: { 'fill-color': color, 'fill-opacity': opacity * FILL_OPACITY },
  },
  {
    id: `${id}-outline`,
    type: 'line' as const,
    source: id,
    layout: { visibility: 'visible' as const },
    paint: { 'line-color': strokeColor, 'line-width': 2, 'line-opacity': opacity },
  },
];

const addBounds = (map: Map, id: string, bounds: LngLatBounds, colors: BoxColors) => {
  map.addSource(id, { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: boundsToGeoJSON(bounds) as GeoJSON.Geometry } });
  for (const layer of boundsLayers(id, colors)) map.addLayer(layer);
};

/**
 * Put everything an overview draws on the map, in the order it has to be drawn in.
 *
 * Bottom to top: the area being searched, the extent of the highlighted result, the numbers, and the
 * highlighted number last of all. All of it comes off and goes back on rather than being changed in
 * place, because addLayer appends and there is no other way to say which of these sits over which.
 * Nothing here reaches the network, so moving one highlight costs a rebuild of eight style layers
 * and nothing else.
 */
export const drawResults = (map: Map, style: MapLibreStyle, { extents, highlighted, searchBounds }: DrawnResults) => {
  clearResults(map);

  if (searchBounds) {
    addBounds(map, SEARCH_BOUNDS, searchBounds, { color: style.dataColor, strokeColor: style.strokeColor, opacity: style.boundsOpacity });
  }

  // Nothing for a highlight that landed on a result nobody could place. That is the truth rather than
  // a gap: there is no number on the map to bring forward and no extent to draw around.
  const extent = highlighted === undefined ? undefined : extents[highlighted - 1];
  if (extent) {
    addBounds(map, HIGHLIGHT_BOUNDS, LngLatBounds.convert(extent), { color: style.highlightColor, strokeColor: style.strokeHighlightColor, opacity: style.highlightOpacity });
  }

  map.addSource(RESULT_NUMBERS, { type: 'geojson', data: numberedResults(extents, highlighted) });
  for (const layer of [...resultNumbersLayers(style), ...resultNumbersLayers(style, true)]) map.addLayer(layer);
};

// Every layer this draws, and every source under them. The layers go first: a source can't be taken
// off the map while a layer is still reading it.
const RESULT_LAYERS = [
  ...[SEARCH_BOUNDS, HIGHLIGHT_BOUNDS].flatMap(id => [`${id}-fill`, `${id}-outline`]),
  ...[RESULT_NUMBERS, RESULT_HIGHLIGHT].flatMap(id => [`${id}-circle`, `${id}-label`]),
];
const RESULT_SOURCES = [SEARCH_BOUNDS, HIGHLIGHT_BOUNDS, RESULT_NUMBERS];

// Take all of it back off. Guarded both ways: a theme swap empties the style document without asking,
// so what this last drew may already be gone.
export const clearResults = (map: Map) => {
  for (const id of RESULT_LAYERS) if (map.getLayer(id)) map.removeLayer(id);
  for (const id of RESULT_SOURCES) if (map.getSource(id)) map.removeSource(id);
};
