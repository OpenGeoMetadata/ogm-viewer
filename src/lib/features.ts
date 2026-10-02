import type { MapGeoJSONFeature } from 'maplibre-gl';

// A source, source layer and feature id together name a feature. That is the same triple
// setFeatureState takes, and it stringifies the id before using it as a key, so ids that stringify
// alike are one feature to the map and should be one feature here too.
const identify = (feature: MapGeoJSONFeature): string => JSON.stringify([feature.source, feature.sourceLayer, String(feature.id)]);

const identified = (feature: MapGeoJSONFeature): boolean => feature.id !== undefined && feature.id !== null;

// Every symbol layer a vector preview draws is one of its labels
const isLabel = (feature: MapGeoJSONFeature): boolean => feature.layer?.type === 'symbol';

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
//
// Which entry is kept also decides where the feature sits in the list, which is why a label's entry
// gives way to the feature's own. MapLibre answers topmost first, and a label is drawn over every
// shape, so whatever a label named used to lead the list. But features that share an outline share
// one label - an index map stacks a sheet's editions one over another - and which of them gets it is
// down to how MapLibre places labels, not to the stack. So a click on a sheet's label opened at
// whichever edition had it, while a click beside the label opened at the edition drawn on top.
// Placed by their shapes, a stack lists the same way wherever the click lands. A feature the click
// reached only through its label, like a point whose label sits above it, keeps the place its label
// gave it.
export const dedupeFeatures = (features: readonly MapGeoJSONFeature[]): MapGeoJSONFeature[] => {
  const drawn = new Set(features.filter(feature => identified(feature) && !isLabel(feature)).map(identify));
  const seen = new Set<string>();
  return features.filter(feature => {
    if (!identified(feature)) return true;
    const identity = identify(feature);
    if (seen.has(identity) || (isLabel(feature) && drawn.has(identity))) return false;
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
