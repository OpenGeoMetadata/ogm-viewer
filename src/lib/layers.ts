import type { LayerSpecification as MapLibreLayerSpecification } from 'maplibre-gl';

import type { ColorRampName } from './colormap';

// A MapLibre style layer, one piece of a logical layer. Vector layers can have
// multiple of these, e.g. to style fills, outlines, and labels separately.
export type PreviewStyleLayer = {
  id: string;
  // 'custom' is not one of MapLibre's style layer types: it's what a preview drawn by something
  // else - an Allmaps warped map, a deck.gl overlay - reports. Such a layer paints itself with its
  // own WebGL, so MapLibre has no paint property to set on it and rejects the ones a style layer
  // would take. MapPreviewer.applyStyleLayerState is the seam those previewers override instead.
  type: MapLibreLayerSpecification['type'] | 'custom';
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
  // Present only for a layer whose values are read off a color ramp rather than shown as-is - a
  // single-band COG of floats or signed integers; see src/lib/previewers/cog-pipeline.ts. Its
  // presence is what marks a layer as rampable at all, both to the layers panel (which draws a ramp
  // picker only for these layers) and to resolveLayerState below (which needs a ramp to default to).
  defaultColorRamp?: ColorRampName;
  // The values defaultColorRamp is stretched across, in the data's own units - what a legend labels
  // its ends with. A fixed fact about the layer, not something the user chooses, so unlike the ramp
  // itself it has no counterpart on LayerState; it travels with the layer the same way title does.
  colorRampRange?: readonly [min: number, max: number];
};

// Attributes of a layer that the user can toggle in the control panel
export type LayerState = { visible: boolean; opacity: number; colorRamp?: ColorRampName };

// Data for a single entry in the layers control panel
export type LayerControl = { id: string; title: string; colorRampRange?: Layer['colorRampRange'] } & LayerState;

// Get the initial state for a layer. Field by field against the layer's own defaults, not the
// stored state wholesale: a state already on record from before colorRamp existed - or from a
// change to some other field, made while colorRamp was untouched - carries no colorRamp key of its
// own, and that has to fall back to the layer's default rather than surface as undefined.
export const resolveLayerState = (layer: Layer, states: ReadonlyMap<string, LayerState>): LayerState => {
  const requested = states.get(layer.id);
  return {
    visible: requested?.visible ?? true,
    opacity: requested?.opacity ?? layer.defaultOpacity,
    colorRamp: requested?.colorRamp ?? layer.defaultColorRamp,
  };
};

// Used to check if the layer should be inspectable; needs to be both toggled on and not fully faded
export const isLayerDrawn = ({ visible, opacity }: LayerState): boolean => visible && opacity > 0;

// Which of a panel's rows a legend has anything to say about: drawn, and carrying both halves of a
// ramp - the color and the range it's stretched across. Shared between <ogm-map>, which uses this
// to decide whether to mount <ogm-legend> at all, and <ogm-legend> itself, which uses it to decide
// what to render - the same question asked twice would drift if answered twice. Mounting matters on
// its own, separately from what gets rendered: an unconditionally-mounted custom element sibling has
// been observed, in this component tree specifically, to perturb the timing of a *different*
// component's own async lifecycle - see the note on this in ogm-map.tsx's render().
export const rampedLayers = (layers: readonly LayerControl[]): LayerControl[] =>
  layers.filter(layer => isLayerDrawn(layer) && layer.colorRamp !== undefined && layer.colorRampRange !== undefined);

export const toLayerControlItems = (layers: readonly Layer[], states: ReadonlyMap<string, LayerState>): LayerControl[] =>
  layers.map(layer => {
    const { visible, opacity, colorRamp } = resolveLayerState(layer, states);
    // Left off a layer with no ramp of its own, rather than carried as undefined: ordinary vector
    // and raster layers are most of what this list holds, and there is no reason for their entries
    // to grow two keys that never mean anything for them.
    return { id: layer.id, title: layer.title, visible, opacity, ...(colorRamp !== undefined && { colorRamp, colorRampRange: layer.colorRampRange }) };
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
