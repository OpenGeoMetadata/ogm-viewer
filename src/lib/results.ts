import {
  LngLatBounds,
  type ExpressionSpecification,
  type FillLayerSpecification,
  type LineLayerSpecification,
  type LngLatBoundsLike,
  type Map,
  type SymbolLayerSpecification,
} from 'maplibre-gl';

import { boundsToGeoJSON } from './geometry';
import { FILL_OPACITY } from './previewers/location';
import { contrastColor } from './themes/color';
import type { MapLibreStyle } from './themes/maplibre';

// The source that carries the result numbers and the one layer that draws them. Not derived from
// anything - there is exactly one set of these on a map, however many results are drawn on it.
export const RESULT_NUMBERS = 'ogm-result-numbers';
export const RESULT_MARKERS = `${RESULT_NUMBERS}-markers`;

// What an image of one marker is called. One per number on the map, plus one more for the number
// something outside has asked to highlight; see markerImage.
export const MARKER_IMAGE = 'ogm-result-marker';

// The two boxes drawn under the numbers: the area a search is filtered to, and the extent of the
// highlighted result. A source each rather than two features of one, because they are two different
// statements about the map, drawn in different colors, arriving at different times.
export const SEARCH_BOUNDS = 'ogm-search-bounds';
export const HIGHLIGHT_BOUNDS = 'ogm-highlight-bounds';

// How much bigger a result's number is drawn than a label on a feature. Deliberately not themed,
// for the reason LocationPreviewer's FILL_OPACITY isn't: this is the relationship between a number
// read against a whole globe and the text drawn beside a feature, not a value an embedding app has
// a reason to name. Setting --ogm-text-size still moves both together.
const NUMBER_SIZE = 1.5;

// How wide the disc behind a number is, as a multiple of the number's own size. One size for every
// marker, whatever it says and however far the map is zoomed: these are read as a set, and a set of
// discs that are not the same size reads as a set of different things. A number too long for the disc
// is drawn smaller rather than given a bigger one - see markerImage.
const MARKER_RADIUS = 1.05;

// The ring around a disc, in CSS pixels. The same width a location's outline is drawn at. It is what
// holds a disc apart from the basemap, and from the disc beside it when two results overlap.
const MARKER_RING = 2;

// How much of the disc a numeral is allowed to fill across. Past this the numeral is drawn smaller,
// which is what keeps a four-digit result inside the same disc as a one-digit one.
const NUMERAL_WIDTH = 0.72;

// The most a disc is drawn at, however many pixels the display has. Two is every screen worth
// drawing for; past it the image is memory spent on detail nothing can show.
const MAX_PIXEL_RATIO = 2;

// Where the highlighted marker sorts. Above every other, which are sorted at minus their own number:
// see resultMarkersLayer.
const HIGHLIGHT_SORT_KEY = 1;

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
    const label = String(index + 1);
    const marked = index + 1 === highlighted;

    return [
      {
        type: 'Feature' as const,
        // The image each one is drawn as, named on the feature rather than worked out in an
        // expression, so there is one place that decides which marker wears which picture.
        properties: { label, highlighted: marked, icon: markerImageId(label, marked) },
        geometry: { type: 'Point' as const, coordinates: [lng, lat] },
      },
    ];
  }),
});

// What the image for one marker is called
export const markerImageId = (label: string, highlighted: boolean = false): string => `${MARKER_IMAGE}${highlighted ? '-highlight' : ''}-${label}`;

/**
 * The one layer every marker is drawn from: an image apiece, and nothing else.
 *
 * A disc with a numeral on it, drawn as one picture rather than as a circle with text over it. Two
 * layers would be the obvious way and it cannot be made to work: a symbol layer draws all of its text
 * after all of its icons, and a circle layer draws every circle before any layer above it, so with the
 * numbers in a layer of their own *every* number lands over *every* disc - including its neighbour's.
 * One image per marker is what makes overlapping markers read as markers: whichever is on top covers
 * the one under it whole, disc and number together, which is the only arrangement in which a number is
 * always the one thing you can see of the marker it belongs to.
 *
 * It is also what makes the size of a disc ours rather than MapLibre's, and what lets a numeral be
 * bold: `text-font` names a fontstack the basemap's glyph endpoint has to serve, and a stack CARTO
 * doesn't serve draws nothing at all, so nothing asked of MapLibre could be.
 *
 * Nothing is ever culled. A number that isn't there is worse than one that overlaps, because the list
 * beside the map is counting on every one of them being findable. What is deliberately not asked for
 * is `icon-ignore-placement`: keeping our markers out of the collision grid would leave the basemap's
 * own labels free to draw underneath them, which is the most cluttered thing they could sit on. In the
 * grid a basemap label that collides with a marker is dropped instead - and ours still can't be,
 * because allowing overlap skips the hit test for them entirely and placement runs from the top layer
 * down, so these are placed before anything the basemap wanted that space for.
 */
export const resultMarkersLayer = (): SymbolLayerSpecification => ({
  id: RESULT_MARKERS,
  type: 'symbol' as const,
  source: RESULT_NUMBERS,
  layout: {
    'visibility': 'visible' as const,
    'icon-image': ['get', 'icon'] as const,
    'icon-allow-overlap': true,
    // Earlier results on top, so counting down the list beside the map is counting away from the
    // reader: the first result is the one a page put first, and it stays over the twentieth however the
    // map is panned. A higher key draws over a lower one, so the key is the number negated - and the
    // highlighted one, which something outside has pointed at, sorts above all of them. Without a key
    // at all MapLibre orders these by where they land on screen, and they restack as the map moves,
    // which reads as the numbers rearranging themselves.
    'symbol-sort-key': markerSortKey,
  },
});

const markerSortKey: ExpressionSpecification = ['case', ['get', 'highlighted'], HIGHLIGHT_SORT_KEY, ['-', 0, ['to-number', ['get', 'label']]]];

/**
 * A disc with a numeral centered on it, as pixels MapLibre can draw as an icon.
 *
 * Drawn here rather than described to MapLibre because a marker has to be one picture; see
 * resultMarkersLayer. Which also means the numeral is placed by measuring it: canvas centers text on
 * the font's own box, and a digit - which has no descender to speak of - sits high in that box, so
 * what is centered has to be the ink rather than the line it sits on.
 *
 * Drawn at the display's own pixel ratio and handed over with it, so a marker is as crisp as the map
 * under it. Nothing comes back where there is nothing to draw on - a DOM without a canvas behind it,
 * or no DOM at all - and the caller carries on without the picture rather than without the map.
 */
export const markerImage = (label: string, color: string, style: MapLibreStyle, pixelRatio: number): { width: number; height: number; data: Uint8ClampedArray } | undefined => {
  const size = style.textSize * NUMBER_SIZE;
  const radius = size * MARKER_RADIUS;
  const box = Math.ceil((radius + MARKER_RING) * 2);
  const scale = Math.min(pixelRatio, MAX_PIXEL_RATIO);

  if (typeof document === 'undefined') return undefined;

  const canvas = document.createElement('canvas');
  canvas.width = box * scale;
  canvas.height = box * scale;

  const context = canvas.getContext('2d');
  if (!context) return undefined;

  context.scale(scale, scale);
  const center = box / 2;

  context.beginPath();
  context.arc(center, center, radius, 0, Math.PI * 2);
  context.fillStyle = color;
  context.fill();
  context.lineWidth = MARKER_RING;
  // The same ink as the numeral, so a marker reads as one shape with a rim rather than as a disc with
  // something drawn on it
  context.strokeStyle = contrastColor(color) || style.textHaloColor;
  context.stroke();

  context.fillStyle = contrastColor(color) || style.textHaloColor;
  context.textAlign = 'center';
  context.textBaseline = 'alphabetic';
  context.font = numeralFont(context, label, size, radius, style.markerFont);

  // The middle of the ink, rather than the middle of the line box it was measured in
  const metrics = context.measureText(label);
  const ink = (metrics.actualBoundingBoxAscent ?? size * 0.7) - (metrics.actualBoundingBoxDescent ?? 0);
  context.fillText(label, center, center + ink / 2);

  return { width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data };
};

// The numeral at a size that fits the disc it sits on. Every disc is the same size, so a number long
// enough to reach the rim is the thing that gives way: three digits still fill the disc, and a page
// with a thousand results in it gets smaller numbers rather than bigger markers.
const numeralFont = (context: CanvasRenderingContext2D, label: string, size: number, radius: number, family: string): string => {
  const room = radius * 2 * NUMERAL_WIDTH;
  context.font = `bold ${size}px ${family}`;
  const width = context.measureText(label).width;

  return width <= room ? context.font : `bold ${Math.floor((size * room) / width)}px ${family}`;
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
 * Bottom to top: the area being searched, the extent of the highlighted result, and the markers. All
 * of it comes off and goes back on rather than being changed in place, because addLayer appends and
 * there is no other way to say which of these sits over which. Nothing here reaches the network - the
 * markers are drawn on a canvas and the boxes are two shapes - so moving one highlight costs a handful
 * of style layers and as many small pictures as there are results.
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

  const numbers = numberedResults(extents, highlighted);
  addMarkerImages(map, style, numbers);
  map.addSource(RESULT_NUMBERS, { type: 'geojson', data: numbers });
  map.addLayer(resultMarkersLayer());
};

// A picture for every marker about to be drawn, in the colors the theme is currently in. Added rather
// than reused, because clearResults has just taken the last set away: a theme swap changes what these
// look like, and holding onto one drawn in the old palette would put a marker from the last theme on
// the map. A DOM with no canvas in it draws none of them and the markers come out empty, which is a
// map missing its numbers rather than a map that failed to open; see markerImage.
const addMarkerImages = (map: Map, style: MapLibreStyle, numbers: GeoJSON.FeatureCollection<GeoJSON.Point>) => {
  const ratio = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;

  for (const { properties } of numbers.features) {
    const { label, highlighted, icon } = properties as { label: string; highlighted: boolean; icon: string };
    const image = markerImage(label, highlighted ? style.markerHighlightColor : style.markerColor, style, ratio);
    if (image) map.addImage(icon, image, { pixelRatio: Math.min(ratio, MAX_PIXEL_RATIO) });
  }
};

// Every layer this draws, and every source under them. The layers go first: a source can't be taken
// off the map while a layer is still reading it.
const RESULT_LAYERS = [...[SEARCH_BOUNDS, HIGHLIGHT_BOUNDS].flatMap(id => [`${id}-fill`, `${id}-outline`]), RESULT_MARKERS];
const RESULT_SOURCES = [SEARCH_BOUNDS, HIGHLIGHT_BOUNDS, RESULT_NUMBERS];

/**
 * Take all of it back off, pictures included.
 *
 * Guarded every way: a theme swap empties the style document without asking, so what this last drew
 * may already be gone - and the images go with it, since they live on the style rather than on the map.
 * The pictures are found by name rather than remembered, so a set left behind by a draw nobody
 * finished is taken away too.
 */
export const clearResults = (map: Map) => {
  for (const id of RESULT_LAYERS) if (map.getLayer(id)) map.removeLayer(id);
  for (const id of RESULT_SOURCES) if (map.getSource(id)) map.removeSource(id);
  for (const id of map.listImages()) if (id.startsWith(MARKER_IMAGE)) map.removeImage(id);
};
