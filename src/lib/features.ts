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

// Preference order for feature properties used to render the popup title
// when inspecting the feature. These are just commonly used names for
// properties, we prefer an explicit 'title' but will take anything
// reasonable that we find. More descriptive is better.
const TITLE_KEYS = ['title', 'name', 'label', 'id'] as const;

// Derive a title for a feature from its properties, using the first match
// from TITLE_KEYS in the order listed above. Used by the attributes popup.
export const getFeatureTitle = (feature: MapGeoJSONFeature): string | undefined => {
  const originalKeys = Object.keys(feature.properties || {});
  if (originalKeys.length === 0) return;
  const key = TITLE_KEYS.map(k => originalKeys.find(ok => ok.toLowerCase() === k)).find(Boolean);
  if (key) return feature.properties?.[key];
};
