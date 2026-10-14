import type { ExpressionSpecification, MapGeoJSONFeature } from 'maplibre-gl';

type ComparableValue = string | number | boolean;

export const identified = (feature: MapGeoJSONFeature): boolean => feature.id !== undefined && feature.id !== null;

// The properties a filter can compare, sorted by key so that two tiles holding pieces of one feature
// read alike whatever order each lists them in
const comparableProperties = (feature: MapGeoJSONFeature): [string, ComparableValue][] =>
  Object.entries(feature.properties ?? {})
    .filter((entry): entry is [string, ComparableValue] => ['string', 'number', 'boolean'].includes(typeof entry[1]))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

// A source, source layer and feature id together name a feature. That is the same triple
// setFeatureState takes, and it stringifies the id before using it as a key, so ids that stringify
// alike are one feature to the map and should be one feature here too.
const identify = (feature: MapGeoJSONFeature): string | undefined => {
  if (identified(feature)) return JSON.stringify([feature.source, feature.sourceLayer, String(feature.id)]);
  if (feature.sourceLayer === undefined) return undefined;

  const properties = comparableProperties(feature);
  return properties.length > 0 ? JSON.stringify([feature.source, feature.sourceLayer, properties]) : undefined;
};

// A filter matching a tile feature that has no id, used to draw its selected state without using feature state
export const propertyFilter = (feature: MapGeoJSONFeature): ExpressionSpecification | undefined => {
  const properties = comparableProperties(feature);
  if (properties.length === 0) return undefined;
  return ['all', ...properties.map(([key, value]): ExpressionSpecification => ['==', ['get', key], value])];
};

// Every symbol layer a vector preview draws is one of its labels
const isLabel = (feature: MapGeoJSONFeature): boolean => feature.layer?.type === 'symbol';

// Pick an authoritative feature when there's duplicates. When inspecting, you get
// one feature per chunk of geometry, which results in duplication across things like MultiPolygons.
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

// Derive a title for a feature. An explicit label in the data (e.g. from an OpenIndexMap, where it
// names the sheet) is what a reader would recognize, so that wins. Other attributes like "title" are
// used inconsistently across data sources, so we don't rely on them.
export const getFeatureTitle = (feature: MapGeoJSONFeature): string => feature.properties?.label || 'Feature';
