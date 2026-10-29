import type { ExpressionSpecification, MapGeoJSONFeature } from 'maplibre-gl';
import polylabel from 'polylabel';

import { pixelSpan } from './geometry';

export const LABEL_POINT = 'ogm:label-point';

export const IS_LABEL_POINT: ExpressionSpecification = ['has', LABEL_POINT];

const PRECISION = 100;

const MAX_LINE_WIDTH = 10;
const LINE_HEIGHT = 1.2;

const GLYPH_WIDTH = 0.5;
const WIDE_GLYPH = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6\u{20000}-\u{3fffd}]/u;

// MapLibre wraps at spaces, and between any two ideographs.
const BREAKABLE = /\s|[\u2e80-\u9fff\uf900-\ufaff\u{20000}-\u{3fffd}]/u;

const MAX_ZOOM = 24;

type Polygon = GeoJSON.Position[][];

type Bbox = [west: number, south: number, east: number, north: number];

const polygonsOf = (geometry: GeoJSON.Geometry | null): Polygon[] => {
  switch (geometry?.type) {
    case 'Polygon':
      return [geometry.coordinates];
    case 'MultiPolygon':
      return geometry.coordinates;
    case 'GeometryCollection':
      return geometry.geometries.flatMap(polygonsOf);
    default:
      return [];
  }
};

const ringArea = (ring: GeoJSON.Position[]): number => {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return Math.abs(sum) / 2;
};

const largestPolygon = (geometry: GeoJSON.Geometry | null): { polygon: Polygon; bbox: Bbox } | undefined => {
  let largest: Polygon | undefined;
  let largestArea = -1;
  for (const polygon of polygonsOf(geometry)) {
    if (!(polygon[0]?.length >= 4)) continue;
    const area = ringArea(polygon[0]);
    if (area > largestArea) [largest, largestArea] = [polygon, area];
  }
  if (!largest) return undefined;

  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of largest[0]) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { polygon: largest, bbox: [minX, minY, maxX, maxY] };
};

// Pick a point to label geometry using the largest shape's center
export const labelPoint = (geometry: GeoJSON.Geometry | null): GeoJSON.Position | undefined => {
  const largest = largestPolygon(geometry);
  if (!largest) return undefined;

  const [minX, minY, maxX, maxY] = largest.bbox;
  const [x, y] = polylabel(largest.polygon as [number, number][][], Math.min(maxX - minX, maxY - minY) / PRECISION);
  return [x, y];
};

// Estimate a label's box in ems
export const labelSize = (text: string): [width: number, height: number] => {
  let width = 0;
  for (const glyph of text) width += WIDE_GLYPH.test(glyph) ? 1 : GLYPH_WIDTH;

  const lines = BREAKABLE.test(text) ? Math.max(1, Math.ceil(width / MAX_LINE_WIDTH)) : 1;
  return [width / lines, lines * LINE_HEIGHT];
};

const featuresOf = (data: GeoJSON.GeoJSON): GeoJSON.Feature[] => {
  switch (data.type) {
    case 'FeatureCollection':
      return data.features;
    case 'Feature':
      return [data];
    default:
      return [{ type: 'Feature', geometry: data, properties: {} }];
  }
};

// Zoom at which it makes sense to label polygons, because they won't be as crowded
export const labelMinZoom = (data: GeoJSON.GeoJSON, textSize: number): number => {
  const zooms = featuresOf(data)
    .flatMap(({ geometry, properties }) => {
      const text = properties?.label ?? properties?.id;
      const largest = largestPolygon(geometry);
      if (text == null || text === '' || !largest) return [];

      const [labelWidth, labelHeight] = labelSize(String(text));
      const [width, height] = pixelSpan(largest.bbox);
      if (!(width > 0 && height > 0)) return [];

      return [Math.log2(textSize * Math.max(labelWidth / width, labelHeight / height))];
    })
    .sort((a, b) => a - b);

  return Math.min(MAX_ZOOM, Math.max(0, zooms[Math.floor(zooms.length / 2)] ?? 0));
};

const labelled = new WeakMap<GeoJSON.GeoJSON, GeoJSON.FeatureCollection>();

// Keep label points in the same source so labels retain feature-state and opacity behavior.
export const withLabelPoints = (data: GeoJSON.GeoJSON): GeoJSON.FeatureCollection => {
  const cached = labelled.get(data);
  if (cached) return cached;

  const features = featuresOf(data).map((feature, index): GeoJSON.Feature => ({ ...feature, id: index }));
  const points = features.flatMap((feature): GeoJSON.Feature[] => {
    const coordinates = labelPoint(feature.geometry);
    if (!coordinates) return [];
    return [{ type: 'Feature', id: feature.id, geometry: { type: 'Point', coordinates }, properties: { ...feature.properties, [LABEL_POINT]: true } }];
  });

  const document: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [...features, ...points] };
  labelled.set(data, document);
  return document;
};

// Preserve the feature prototype because MapLibre exposes geometry through a getter.
export const unmarkLabelPoints = (features: MapGeoJSONFeature[]): MapGeoJSONFeature[] =>
  features.map(feature => {
    if (!feature.properties || !(LABEL_POINT in feature.properties)) return feature;

    const { [LABEL_POINT]: _marker, ...properties } = feature.properties;
    const unmarked = Object.assign(Object.create(Object.getPrototypeOf(feature)) as MapGeoJSONFeature, feature);
    unmarked.properties = properties;
    return unmarked;
  });
