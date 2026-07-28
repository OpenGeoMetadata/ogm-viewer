import type { LayerSpecification } from 'maplibre-gl';

// One MapLibre style layer inside a logical layer, and what we need in order to control it
export type PreviewStyleLayer = {
  id: string;
  type: LayerSpecification['type'];
  // Machinery rather than data - a selection highlight. It hides with its layer, but never dims
  // with it: an outline the server drew for us has to stay legible at any opacity.
  internal?: boolean;
};

// A layer as a reader thinks of it: one row in the layer control. One row is often several style
// layers - a vector layer is drawn by seven - so the control names the group, not the style layer.
// `id` is always derived from a source id, never an array index or fetched text, so the reader's
// choices survive the wholesale style rebuild that a basemap swap causes.
export type PreviewLayer = {
  id: string;
  title: string;
  // The opacity the theme draws this layer at. The slider opens here, and returning to it
  // reproduces the authored paint exactly, which is what makes re-applying state a genuine no-op.
  defaultOpacity: number;
  styleLayers: PreviewStyleLayer[];
};

// What the reader asked for, per row. Opacity is 0-1; the 0-100 integer is a detail of the slider.
export type LayerState = { visible: boolean; opacity: number };

// One row as the panel renders it: plain scalars only, so the component never holds a style spec
// or a reference back to the previewer
export type LayerControlItem = { id: string; title: string; visible: boolean; opacity: number };

// A row the reader hasn't touched follows the theme, rather than a value copied at preview time
// that would go stale the moment the theme changed
export const resolveLayerState = (layer: PreviewLayer, states: ReadonlyMap<string, LayerState>): LayerState =>
  states.get(layer.id) ?? { visible: true, opacity: layer.defaultOpacity };

// Whether a row is actually on the map. An opacity of zero counts as off it: a layer drawn at zero
// opacity is invisible but still answers queryRenderedFeatures, so anything that asks what the
// reader can see has to treat the two the same way.
export const isLayerDrawn = ({ visible, opacity }: LayerState): boolean => visible && opacity > 0;

export const toLayerControlItems = (layers: readonly PreviewLayer[], states: ReadonlyMap<string, LayerState>): LayerControlItem[] =>
  layers.map(layer => {
    const { visible, opacity } = resolveLayerState(layer, states);
    return { id: layer.id, title: layer.title, visible, opacity };
  });

// A tileset names its layers for machines ('landuse_overlay'); a WMTS <ows:Title> is already
// written for people, so only the previewers that produce machine names ask for this. Underscores
// become spaces and the first letter is capitalized, but hyphens and existing capitals are left
// alone: title-casing would mangle a name like 'Orthofoto 2016 Wien', and splitting on hyphens
// would turn 'built-up' into two words the publisher didn't write.
export const humanizeLayerName = (name: string): string => {
  const spaced = name.replace(/_/g, ' ').trim();
  if (!spaced) return name;
  return `${spaced.charAt(0).toUpperCase()}${spaced.slice(1)}`;
};
