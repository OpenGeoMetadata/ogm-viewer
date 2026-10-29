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

export const RESULT_NUMBERS = 'ogm-result-numbers';
export const RESULT_MARKERS = `${RESULT_NUMBERS}-markers`;

const MARKER_IMAGE = 'ogm-result-marker';

export const SEARCH_BOUNDS = 'ogm-search-bounds';
export const HIGHLIGHT_BOUNDS = 'ogm-highlight-bounds';

const NUMBER_SIZE = 1.05;

const MARKER_RADIUS = 1.05;

const MARKER_RING = 2;

const NUMERAL_WIDTH = 0.72;

const MAX_PIXEL_RATIO = 2;

const HIGHLIGHT_GROWTH = 1.15;

const HIGHLIGHT_SORT_KEY = 1;

export type DrawnResults = {
  extents: (LngLatBoundsLike | undefined)[];
  highlighted?: number[];
  searchBounds?: LngLatBounds;
};

type BoxColors = { color: string; strokeColor: string; opacity: number };

// Keep gaps for unlocated records so marker numbers still match the original result list.
export const numberedResults = (extents: (LngLatBoundsLike | undefined)[], style: MapLibreStyle, highlighted: number[] = []): GeoJSON.FeatureCollection<GeoJSON.Point> => ({
  type: 'FeatureCollection',
  features: extents.flatMap((extent, index) => {
    if (!extent) return [];
    const { lng, lat } = LngLatBounds.convert(extent).getCenter();
    const label = String(index + 1);
    const marked = highlighted.includes(index + 1);

    return [
      {
        type: 'Feature' as const,
        properties: { label, highlighted: marked, icon: markerImageId(label, style, marked) },
        geometry: { type: 'Point' as const, coordinates: [lng, lat] },
      },
    ];
  }),
});

// Include the full marker appearance in its image ID so theme changes cannot reuse stale pixels.
export const markerImageId = (label: string, style: MapLibreStyle, highlighted: boolean = false): string =>
  [MARKER_IMAGE, highlighted ? 'highlight' : 'plain', markerLook(style, highlighted), label].join('-');

const markerLook = (style: MapLibreStyle, highlighted: boolean): string => [discColor(style, highlighted), style.textSize, style.markerFont].join('-').replace(/[^\w-]+/g, '');

const discColor = (style: MapLibreStyle, highlighted: boolean): string => (highlighted ? style.markerHighlightColor : style.markerColor);

export const markerMetrics = (style: MapLibreStyle, highlighted: boolean): { size: number; radius: number; box: number } => {
  const size = style.textSize * NUMBER_SIZE * (highlighted ? HIGHLIGHT_GROWTH : 1);
  const radius = size * MARKER_RADIUS;

  return { size, radius, box: Math.ceil((radius + MARKER_RING) * 2) };
};

export const resultMarkersLayer = (): SymbolLayerSpecification => ({
  id: RESULT_MARKERS,
  type: 'symbol' as const,
  source: RESULT_NUMBERS,
  layout: {
    'visibility': 'visible' as const,
    'icon-image': ['get', 'icon'] as const,
    'icon-allow-overlap': true,
    // Earlier results draw on top; highlighted markers sort above all ordinary markers.
    'symbol-sort-key': markerSortKey,
  },
});

const markerSortKey: ExpressionSpecification = ['case', ['get', 'highlighted'], HIGHLIGHT_SORT_KEY, ['-', 0, ['to-number', ['get', 'label']]]];

// Rasterize each marker as one image so its numeral stays centered and collisions treat it as a unit.
export const markerImage = (
  label: string,
  style: MapLibreStyle,
  highlighted: boolean,
  pixelRatio: number,
): { width: number; height: number; data: Uint8ClampedArray } | undefined => {
  const { size, radius, box } = markerMetrics(style, highlighted);
  const color = discColor(style, highlighted);
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
  context.strokeStyle = contrastColor(color) || style.textHaloColor;
  context.stroke();

  context.fillStyle = contrastColor(color) || style.textHaloColor;
  context.textAlign = 'center';
  context.textBaseline = 'alphabetic';
  context.font = numeralFont(context, label, size, radius, style.markerFont);

  const metrics = context.measureText(label);
  const ink = (metrics.actualBoundingBoxAscent ?? size * 0.7) - (metrics.actualBoundingBoxDescent ?? 0);
  context.fillText(label, center, center + ink / 2);

  return { width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data };
};

// Shrink long numbers to fit a fixed disc so marker sizes stay consistent.
const numeralFont = (context: CanvasRenderingContext2D, label: string, size: number, radius: number, family: string): string => {
  const room = radius * 2 * NUMERAL_WIDTH;
  context.font = `bold ${size}px ${family}`;
  const width = context.measureText(label).width;

  return width <= room ? context.font : `bold ${Math.floor((size * room) / width)}px ${family}`;
};

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

const boundsData = (bounds: (LngLatBounds | undefined)[]): GeoJSON.FeatureCollection => ({
  type: 'FeatureCollection',
  features: bounds.filter((box): box is LngLatBounds => !!box).map(box => ({ type: 'Feature', properties: {}, geometry: boundsToGeoJSON(box) as GeoJSON.Geometry })),
});

type DrawnLayer = FillLayerSpecification | LineLayerSpecification | SymbolLayerSpecification;

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

const repaint = (map: Map, layer: DrawnLayer) => {
  type PaintProperty = Parameters<Map['setPaintProperty']>[1];
  for (const [property, value] of Object.entries(layer.paint ?? {})) map.setPaintProperty(layer.id, property as PaintProperty, value);
};

export const drawResults = (map: Map, style: MapLibreStyle, { extents, highlighted, searchBounds }: DrawnResults) => {
  const numbers = numberedResults(extents, style, highlighted);

  syncMarkerImages(map, style, numbers);

  drawInto(map, SEARCH_BOUNDS, boundsData([searchBounds]), boundsLayers(SEARCH_BOUNDS, { color: style.dataColor, strokeColor: style.strokeColor, opacity: style.boundsOpacity }));

  const marked = (highlighted ?? []).map(place => extents[place - 1]).map(extent => (extent ? LngLatBounds.convert(extent) : undefined));

  const highlight = { color: style.highlightColor, strokeColor: style.strokeHighlightColor, opacity: style.highlightOpacity };
  drawInto(map, HIGHLIGHT_BOUNDS, boundsData(marked), boundsLayers(HIGHLIGHT_BOUNDS, highlight));

  drawInto(map, RESULT_NUMBERS, numbers, [resultMarkersLayer()]);
};

// Preload ordinary and highlighted images so hover never waits for a new image.
const syncMarkerImages = (map: Map, style: MapLibreStyle, numbers: GeoJSON.FeatureCollection<GeoJSON.Point>) => {
  const ratio = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;

  const wanted = numbers.features.flatMap(({ properties }) => {
    const label = String(properties?.label);
    return [false, true].map(highlighted => ({ id: markerImageId(label, style, highlighted), label, highlighted }));
  });

  const keep = new Set(wanted.map(({ id }) => id));
  for (const id of map.listImages()) if (id.startsWith(MARKER_IMAGE) && !keep.has(id)) map.removeImage(id);

  for (const { id, label, highlighted } of wanted) {
    if (map.hasImage(id)) continue;
    const image = markerImage(label, style, highlighted, ratio);
    if (image) map.addImage(id, image, { pixelRatio: Math.min(ratio, MAX_PIXEL_RATIO) });
  }
};
