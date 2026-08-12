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

// Derive a title for a feature. An explicit label in the data (e.g. from an OpenIndexMap, where it
// names the sheet) is what a reader would recognize, so that wins. Other attributes like "title" are
// used inconsistently across data sources, so we don't rely on them.
//
// Failing a label there is nothing to call it, and the id is not a name: it's either one nobody put
// there - MapLibre numbers a GeoJSON source's features by position, and a server-queried preview has
// no features until we ask, so those are numbered too, which is why the first of them was always
// "Feature 0" - or an opaque key like "cugir007741.1". The header already says which of a stack you
// are looking at, so an unnamed feature is just a feature.
export const getFeatureTitle = (feature: MapGeoJSONFeature): string => feature.properties?.label || 'Feature';
