import type { LayerSpecification as MapLibreLayerSpecification } from 'maplibre-gl';

// A MapLibre style layer, one piece of a logical layer. Vector layers can have
// multiple of these, e.g. to style fills, outlines, and labels separately.
export type PreviewStyleLayer = {
  id: string;
  type: MapLibreLayerSpecification['type'];
  // "Internal" means it's a style layer that is created artificially, e.g. to
  // highlight a feature on the map, and thus shouldn't be listed in layer controls
  internal?: boolean;
};

// A logical layer, which can be turned off/on and have its opacity adjusted.
// Can comprise multiple style layers, e.g. a vector layer with fills, outlines, and labels.
export type Layer = {
  id: string;
  title: string;
  defaultOpacity: number;
  styleLayers: PreviewStyleLayer[];
};

// Attributes of a layer that the user can toggle in the control panel
export type LayerState = { visible: boolean; opacity: number };

// Data for a single entry in the layers control panel
export type LayerControl = { id: string; title: string } & LayerState;

// Get the initial state for a layer
export const resolveLayerState = (layer: Layer, states: ReadonlyMap<string, LayerState>): LayerState => states.get(layer.id) ?? { visible: true, opacity: layer.defaultOpacity };

// Used to check if the layer should be inspectable; needs to be both toggled on and not fully faded
export const isLayerDrawn = ({ visible, opacity }: LayerState): boolean => visible && opacity > 0;

export const toLayerControlItems = (layers: readonly Layer[], states: ReadonlyMap<string, LayerState>): LayerControl[] =>
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
