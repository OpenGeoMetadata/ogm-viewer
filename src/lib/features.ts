import type { MapGeoJSONFeature } from 'maplibre-gl';

// A source, source layer and feature id together name a feature. That is the same triple
// setFeatureState takes, and it stringifies the id before using it as a key, so ids that stringify
// alike are one feature to the map and should be one feature here too.
const identify = (feature: MapGeoJSONFeature): string => JSON.stringify([feature.source, feature.sourceLayer, String(feature.id)]);

// An inspection answers with one entry per drawn piece of a feature rather than one per feature: a
// polygon split across two tiles comes back from each of them, a MultiPolygon whose parts both cover
// the click comes back per part, and a feature drawn by both a fill and its outline comes back from
// each style layer. The attributes popup pages through this list, so the repeats read as extra
// features that describe the same record twice.
//
// The first entry for a feature is kept and the rest dropped, which loses nothing: entries naming the
// same feature carry the same properties, and one setFeatureState call would highlight all of them.
// An entry with no id has nothing to be identified by - a GetFeatureInfo response may answer without
// one - so those are all kept, since collapsing them would hide genuinely different features.
export const dedupeFeatures = (features: readonly MapGeoJSONFeature[]): MapGeoJSONFeature[] => {
  const seen = new Set<string>();
  return features.filter(feature => {
    if (feature.id === undefined || feature.id === null) return true;
    const identity = identify(feature);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
};

// Derive a title for a feature. If there is an explicit label in the data
// (e.g. from an OpenIndexMap, where it indicates the sheet name), we use that.
// Otherwise we fall back to the (potentially auto-generated) feature id, which
// is guaranteed to be present. Other attributes like "title" are used inconsistently
// across different data sources, so we don't rely on them.
export const getFeatureTitle = (feature: MapGeoJSONFeature): string | undefined => {
  if (feature.properties?.label) return feature.properties.label;
  return `Feature ${feature.id}`;
};
