import type { ExpressionSpecification, MapGeoJSONFeature } from 'maplibre-gl';
import polylabel from 'polylabel';

export const LABEL_POINT = 'ogm:label-point';

export const IS_LABEL_POINT: ExpressionSpecification = ['has', LABEL_POINT];

const PRECISION = 100;

type Polygon = GeoJSON.Position[][];

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

// Use the largest polygon and its pole of inaccessibility; a centroid can fall outside the shape.
export const labelPoint = (geometry: GeoJSON.Geometry | null): GeoJSON.Position | undefined => {
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

  const [x, y] = polylabel(largest as [number, number][][], Math.min(maxX - minX, maxY - minY) / PRECISION);
  return [x, y];
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
