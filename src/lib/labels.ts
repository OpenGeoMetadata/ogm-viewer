import type { ExpressionSpecification, MapGeoJSONFeature } from 'maplibre-gl';
import polylabel from 'polylabel';

/* Logic for rendering labels on polygon features and ensuring that we get one
 * sensibly-placed label per feature, even if it's made up of multiple polygons.
 * Some data has MultiPolygons that can be split across thousands of individual
 * polygons, and MapLibre will render one label per polygon PLUS one label
 * every place it intersects with a tile boundary. We don't want that.
 */

// Unique property name for points that we generate
export const LABEL_POINT = 'ogm:label-point';

// Matches the label points and nothing else
export const IS_LABEL_POINT: ExpressionSpecification = ['has', LABEL_POINT];

// How closely to find the label point, as a fraction of the part's narrower side
const PRECISION = 100;

type Polygon = GeoJSON.Position[][];

// Get all of the coordinates of every polygon type from the geometry
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

// In square degrees; distorted but fine to use for comparison within one feature
const ringArea = (ring: GeoJSON.Position[]): number => {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return Math.abs(sum) / 2;
};

// Where to place the label: pick the largest single part, and then find the place
// furthest from that part's edges. We don't use the centroid because it could
// be outside the polygon entirely, and for disjoint shapes we want to pick the
// most sensible single location, not the average of all parts.
export const labelPoint = (geometry: GeoJSON.Geometry | null): GeoJSON.Position | undefined => {
  let largest: Polygon | undefined;
  let largestArea = -1;
  for (const polygon of polygonsOf(geometry)) {
    // A ring needs four positions to close around anything
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

// Get all of the features from the data
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

// Memoized on the document, which every caller holds memoized already
const labelled = new WeakMap<GeoJSON.GeoJSON, GeoJSON.FeatureCollection>();

// Rewritten geoJSON document with our new label points added. We make sure that
// the label points are added to the same feature collection as the original features
// and with matching IDs so that they can be styled together and queried together.
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

// Labels need to be clickable and behave the way clicking the feature itself
// would behave. This requires prototype fidelity, and the properties object
// has to be identical with the original feature.
export const unmarkLabelPoints = (features: MapGeoJSONFeature[]): MapGeoJSONFeature[] =>
  features.map(feature => {
    if (!feature.properties || !(LABEL_POINT in feature.properties)) return feature;

    const { [LABEL_POINT]: _marker, ...properties } = feature.properties;
    const unmarked = Object.assign(Object.create(Object.getPrototypeOf(feature)) as MapGeoJSONFeature, feature);
    unmarked.properties = properties;
    return unmarked;
  });
