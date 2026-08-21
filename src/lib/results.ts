import {
  LngLatBounds,
  type ExpressionSpecification,
  type FillLayerSpecification,
  type GeoJSONSource,
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

// What an image of one marker is called. Two per number on the map: the picture of that number, and
// the picture of it selected. Both are drawn whether anything has pointed at it or not, so that a
// highlight arriving changes no pictures at all; see syncMarkerImages.
const MARKER_IMAGE = 'ogm-result-marker';

// The two boxes drawn under the numbers: the area a search is filtered to, and the extent of the
// result something outside has pointed at. A source each rather than two features of one, because they
// are two different statements about the map, drawn in different colors, arriving at different times.
// Both stay on the map once drawn, holding nothing when there is nothing to say; see drawInto.
export const SEARCH_BOUNDS = 'ogm-search-bounds';
export const SELECTED_BOUNDS = 'ogm-selected-bounds';

// How big a result's number is drawn, against the size of a label on a feature. A little larger, and
// no more: a marker is read at a glance rather than studied, and a page of twenty of them covers more
// of the map than it says anything about. Deliberately not themed, for the reason LocationPreviewer's
// FILL_OPACITY isn't - this is the relationship between a number and the text drawn beside a feature,
// not a value an embedding app has a reason to name. Setting --ogm-text-size still moves both
// together, and the disc follows the number.
const NUMBER_SIZE = 1.05;

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

// Where the selected marker sorts. Above every other, which are sorted at minus their own number:
// see resultMarkersLayer.
const SELECTED_SORT_KEY = 1;

// Everything an overview draws, gathered in one place because the order it goes onto the map in is
// most of what keeps it readable.
export type DrawnResults = {
  // Where every result is, in the order they were given, including the ones nobody could place
  extents: (LngLatBoundsLike | undefined)[];
  // Which of those results something outside has pointed at, as its place in that list counted from
  // one. It is drawn as a selection rather than as a hover: see drawResults.
  highlighted?: number;
  // The area a search is currently filtered to, if one is
  searchBounds?: LngLatBounds;
};

// What a box is drawn in. The two of them differ in nothing else, so this is the whole of the
// difference between the area being searched and the extent of the result being pointed at.
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
export const numberedResults = (extents: (LngLatBoundsLike | undefined)[], style: MapLibreStyle, highlighted?: number): GeoJSON.FeatureCollection<GeoJSON.Point> => ({
  type: 'FeatureCollection',
  features: extents.flatMap((extent, index) => {
    if (!extent) return [];
    // getCenter() averages the corners as they were written, so a box carrying its east edge past
    // 180 - see unwrapEast - is centered on the Pacific rather than on Greenwich. MapLibre reads a
    // longitude from outside -180..180 everywhere it takes one, so there is nothing to wrap back.
    const { lng, lat } = LngLatBounds.convert(extent).getCenter();
    const label = String(index + 1);
    const selected = index + 1 === highlighted;

    return [
      {
        type: 'Feature' as const,
        // The image each one is drawn as, named on the feature rather than worked out in an
        // expression, so there is one place that decides which marker wears which picture.
        properties: { label, selected, icon: markerImageId(label, style, selected) },
        geometry: { type: 'Point' as const, coordinates: [lng, lat] },
      },
    ];
  }),
});

/**
 * What the image for one marker is called: the number it shows, and everything that decides how it
 * looks.
 *
 * The whole look is in the name because that is what makes a picture safe to keep. A name that said
 * only which marker it was would be reused after a theme swap and the map would go on wearing the last
 * palette's discs: MapLibre carries images across setStyle, since it diffs the new style document
 * against the old one and the diff has nothing to say about images. Named this way, a new palette asks
 * for names that aren't there, gets fresh pictures, and leaves the old names to be taken away - and
 * everything else, which is most redraws, asks for the names already on the map. See syncMarkerImages.
 */
export const markerImageId = (label: string, style: MapLibreStyle, selected: boolean = false): string =>
  [MARKER_IMAGE, selected ? 'selected' : 'plain', markerLook(style, selected), label].join('-');

// What a marker's picture depends on, in a form a name can carry: the color of the disc, the size of
// the numeral, and the font it is set in. Word characters only, since this ends up in an id - and it is
// only ever compared with itself, so what it drops costs nothing.
const markerLook = (style: MapLibreStyle, selected: boolean): string =>
  [selected ? style.markerSelectedColor : style.markerColor, style.textSize, style.markerFont].join('-').replace(/[^\w-]+/g, '');

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
    // selected one, which something outside has pointed at, sorts above all of them. Without a key at
    // all MapLibre orders these by where they land on screen, and they restack as the map moves, which
    // reads as the numbers rearranging themselves.
    'symbol-sort-key': markerSortKey,
  },
});

const markerSortKey: ExpressionSpecification = ['case', ['get', 'selected'], SELECTED_SORT_KEY, ['-', 0, ['to-number', ['get', 'label']]]];

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

// Nothing to say, in the form MapLibre takes it in. A box that isn't there stays on the map as a
// source with no features in it rather than coming off, which is what lets the two layers that read it
// stay on as well; see drawInto.
const NOTHING: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

const boundsData = (bounds: LngLatBounds | undefined): GeoJSON.GeoJSON =>
  bounds ? { type: 'Feature', properties: {}, geometry: boundsToGeoJSON(bounds) as GeoJSON.Geometry } : NOTHING;

// Anything this draws with, which is three kinds of layer over the same kind of source
type DrawnLayer = FillLayerSpecification | LineLayerSpecification | SymbolLayerSpecification;

/**
 * New data into a source already on the map - or the source, and the layers that read it, if this is
 * the first thing drawn into this style document.
 *
 * Which is the whole of what keeps a redraw from flashing. removeSource drops a source's tiles the
 * moment it is called, so a redraw that begins by taking everything off has nothing to draw until a
 * worker has parsed the new data and placed it again: several frames, every one of them missing
 * whatever was there. setData marks the tiles for reloading and leaves them up, so what is on screen
 * stays on screen until there is something to put in its place.
 *
 * The paint goes on again for a source that was already there, so a layer says the same thing however
 * this was reached: these colors come out of the theme, and a theme can change under a map that has
 * already been drawn. What can't be said twice is the order - addLayer appends, so the order these
 * first went on in is the order they keep, and it is fixed by drawResults below.
 */
const drawInto = (map: Map, id: string, data: GeoJSON.GeoJSON, layers: DrawnLayer[]) => {
  const source = map.getSource(id) as GeoJSONSource | undefined;

  if (!source) {
    map.addSource(id, { type: 'geojson', data });
    for (const layer of layers) map.addLayer(layer);
    return;
  }

  source.setData(data);
  for (const layer of layers) repaint(map, layer);
};

// A layer's colors again. A no-op for the markers, which carry no paint at all: what a marker is drawn
// in is in the picture.
const repaint = (map: Map, layer: DrawnLayer) => {
  for (const [property, value] of Object.entries(layer.paint ?? {})) map.setPaintProperty(layer.id, property, value);
};

/**
 * Put everything an overview draws on the map, and from then on change it where it stands.
 *
 * Bottom to top: the area being searched, the extent of the selected result, and the markers. That
 * order is settled the first time this runs and kept by never taking any of it off again - addLayer
 * appends, so a layer put back on would come back above whatever had been added over it.
 *
 * Changed rather than rebuilt, because rebuilding flashes, and the reader sees it: a highlight moves
 * with the pointer down a list of results, so a set of markers that blinks once per redraw blinks the
 * whole way down the page. Two things did it. Taking the sources off dropped their tiles on the spot -
 * see drawInto - and taking the markers' pictures off had MapLibre place every symbol on the map over
 * again, ours and the basemap's labels with them. So nothing comes off: a highlight arriving is two
 * calls to setData, and it touches no layer and no picture at all.
 */
export const drawResults = (map: Map, style: MapLibreStyle, { extents, highlighted, searchBounds }: DrawnResults) => {
  const numbers = numberedResults(extents, style, highlighted);

  // Before the layer that names them, so that no frame asks for a picture that isn't there yet
  syncMarkerImages(map, style, numbers);

  drawInto(map, SEARCH_BOUNDS, boundsData(searchBounds), boundsLayers(SEARCH_BOUNDS, { color: style.dataColor, strokeColor: style.strokeColor, opacity: style.boundsOpacity }));

  // Nothing for a selection that landed on a result nobody could place. That is the truth rather than
  // a gap: there is no number on the map to bring forward and no extent to draw around.
  const extent = highlighted === undefined ? undefined : extents[highlighted - 1];

  // The colors a selected feature is drawn in rather than a hovered one. A hover is what points at
  // it, but what it says is that this is the result being read - and it is drawn at the opacity any
  // called-out feature gets, which is what InspectableRasterPreviewer draws a selection at too.
  const selected = { color: style.selectedColor, strokeColor: style.strokeSelectedColor, opacity: style.highlightOpacity };
  drawInto(map, SELECTED_BOUNDS, boundsData(extent ? LngLatBounds.convert(extent) : undefined), boundsLayers(SELECTED_BOUNDS, selected));

  drawInto(map, RESULT_NUMBERS, numbers, [resultMarkersLayer()]);
};

/**
 * Both pictures of every marker that could be drawn, in the colors the theme is currently in.
 *
 * Both, whether or not anything has pointed at that number, so that which one a marker wears is a
 * property of the feature rather than a picture that has to be swapped for it. That is why a highlight
 * costs nothing: addImage and removeImage each invalidate the icon atlas, which has MapLibre place
 * every symbol on the map over again, so changing one marker's picture would cost a frame of every
 * marker on it. Two canvases per result instead, once.
 *
 * Which pictures are already there is read off the map rather than remembered, and the names carry the
 * whole look - see markerImageId - so a picture is reused exactly when it would have been drawn the
 * same. Both ways a set of pictures goes stale end up here: a theme swap asks for names that aren't on
 * the map yet, and what it leaves behind is unwanted; so is the tail of a set of results that has been
 * replaced by a shorter one. Unwanted pictures are found by our own prefix, so a set left by a draw
 * nobody finished goes with them and nobody else's images are touched.
 *
 * A DOM with no canvas in it draws none of them and the markers come out empty, which is a map missing
 * its numbers rather than a map that failed to open; see markerImage.
 */
const syncMarkerImages = (map: Map, style: MapLibreStyle, numbers: GeoJSON.FeatureCollection<GeoJSON.Point>) => {
  const ratio = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;

  const wanted = numbers.features.flatMap(({ properties }) => {
    const label = String(properties?.label);
    return [
      { id: markerImageId(label, style), label, color: style.markerColor },
      { id: markerImageId(label, style, true), label, color: style.markerSelectedColor },
    ];
  });

  const keep = new Set(wanted.map(({ id }) => id));
  for (const id of map.listImages()) if (id.startsWith(MARKER_IMAGE) && !keep.has(id)) map.removeImage(id);

  for (const { id, label, color } of wanted) {
    if (map.hasImage(id)) continue;
    const image = markerImage(label, color, style, ratio);
    if (image) map.addImage(id, image, { pixelRatio: Math.min(ratio, MAX_PIXEL_RATIO) });
  }
};
