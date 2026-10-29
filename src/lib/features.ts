import type { ExpressionSpecification, MapGeoJSONFeature } from 'maplibre-gl';

type ComparableValue = string | number | boolean;

export const identified = (feature: MapGeoJSONFeature): boolean => feature.id !== undefined && feature.id !== null;

const comparableProperties = (feature: MapGeoJSONFeature): [string, ComparableValue][] =>
  Object.entries(feature.properties ?? {})
    .filter((entry): entry is [string, ComparableValue] => ['string', 'number', 'boolean'].includes(typeof entry[1]))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

// MapLibre identifies features by source, source layer, and a stringified ID.
const identify = (feature: MapGeoJSONFeature): string | undefined => {
  if (identified(feature)) return JSON.stringify([feature.source, feature.sourceLayer, String(feature.id)]);
  if (feature.sourceLayer === undefined) return undefined;

  const properties = comparableProperties(feature);
  return properties.length > 0 ? JSON.stringify([feature.source, feature.sourceLayer, properties]) : undefined;
};

export const propertyFilter = (feature: MapGeoJSONFeature): ExpressionSpecification | undefined => {
  const properties = comparableProperties(feature);
  if (properties.length === 0) return undefined;
  return ['all', ...properties.map(([key, value]): ExpressionSpecification => ['==', ['get', key], value])];
};

const isLabel = (feature: MapGeoJSONFeature): boolean => feature.layer?.type === 'symbol';

export const dedupeFeatures = (features: readonly MapGeoJSONFeature[]): MapGeoJSONFeature[] => {
  const drawn = new Set(features.filter(feature => !isLabel(feature)).map(identify));
  const seen = new Set<string>();
  return features.filter(feature => {
    const identity = identify(feature);
    if (identity === undefined) return true;
    if (seen.has(identity) || (isLabel(feature) && drawn.has(identity))) return false;
    seen.add(identity);
    return true;
  });
};

export const getFeatureTitle = (feature: MapGeoJSONFeature): string => feature.properties?.label || 'Feature';
