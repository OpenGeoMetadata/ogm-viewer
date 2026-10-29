import type { LayerSpecification as MapLibreLayerSpecification } from 'maplibre-gl';

import type { ColorRampName } from './colormap';
import type { LegendImage } from './legend';
import type { Quantity } from './quantity';
import type TimeDomain from './time';

export type PreviewStyleLayer = {
  id: string;
  type: MapLibreLayerSpecification['type'] | 'custom';
  internal?: boolean;
};

export type Layer = {
  id: string;
  title: string;
  defaultOpacity: number;
  styleLayers: PreviewStyleLayer[];
  defaultColorRamp?: ColorRampName;
  colorRampRange?: readonly [min: number, max: number];
  quantity?: Quantity;
  backgroundRemovable?: boolean;
  legendImages?: LegendImage[];
  timeDomain?: TimeDomain;
  defaultTime?: string;
};

export type LayerState = { visible: boolean; opacity: number; colorRamp?: ColorRampName; removeBackground?: boolean; time?: string };

export type LayerControl = {
  id: string;
  title: string;
  colorRampRange?: Layer['colorRampRange'];
  quantity?: Layer['quantity'];
  legendImages?: Layer['legendImages'];
  timeDomain?: Layer['timeDomain'];
} & LayerState;

// Resolve defaults field by field so state saved before optional controls arrive keeps their defaults.
export const resolveLayerState = (layer: Layer, states: ReadonlyMap<string, LayerState>): LayerState => {
  const requested = states.get(layer.id);
  return {
    visible: requested?.visible ?? true,
    opacity: requested?.opacity ?? layer.defaultOpacity,
    colorRamp: requested?.colorRamp ?? layer.defaultColorRamp,
    removeBackground: requested?.removeBackground ?? false,
    time: requested?.time ?? layer.defaultTime,
  };
};

export const isLayerDrawn = ({ visible, opacity }: LayerState): boolean => visible && opacity > 0;

export const rampedLayers = (layers: readonly LayerControl[]): LayerControl[] =>
  layers.filter(layer => isLayerDrawn(layer) && layer.colorRamp !== undefined && layer.colorRampRange !== undefined);

export const timedLayers = (layers: readonly LayerControl[]): LayerControl[] => layers.filter(layer => layer.timeDomain?.offersChoice && layer.time !== undefined);

export const toLayerControlItems = (layers: readonly Layer[], states: ReadonlyMap<string, LayerState>): LayerControl[] =>
  layers.map(layer => {
    const { visible, opacity, colorRamp, removeBackground, time } = resolveLayerState(layer, states);

    return {
      id: layer.id,
      title: layer.title,
      visible,
      opacity,
      ...(colorRamp !== undefined && { colorRamp, colorRampRange: layer.colorRampRange }),
      ...(layer.quantity && { quantity: layer.quantity }),
      ...(layer.backgroundRemovable && { removeBackground }),
      ...(layer.legendImages && { legendImages: layer.legendImages }),
      ...(layer.timeDomain && { time, timeDomain: layer.timeDomain }),
    };
  });

export const humanizeLayerName = (name: string): string => {
  const spaced = name.replace(/_/g, ' ').trim();
  if (!spaced) return name;
  return `${spaced.charAt(0).toUpperCase()}${spaced.slice(1)}`;
};
