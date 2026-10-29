import { isLayerDrawn, type LayerControl } from './layers';

export type LegendEntry = {
  label: string;
  color: string;
};

export type LegendImage = {
  url: string;
  format?: string;
  width?: number;
  height?: number;
  minScaleDenominator?: number;
  maxScaleDenominator?: number;
};

export type ImageLegend = {
  layer: LayerControl;
  image: LegendImage;
};

const STANDARD_PIXEL_SIZE = 0.00028;

const EQUATOR = 2 * Math.PI * 6378137;

// WMTS scale uses 0.28mm pixels; MapLibre zoom uses 512px tiles at the equator.
export const scaleDenominatorAt = (zoom: number): number => EQUATOR / (512 * 2 ** zoom) / STANDARD_PIXEL_SIZE;

const appliesAt = (image: LegendImage, scale: number): boolean =>
  (image.minScaleDenominator === undefined || scale >= image.minScaleDenominator) && (image.maxScaleDenominator === undefined || scale < image.maxScaleDenominator);

const isLandscape = (image: LegendImage): boolean => image.width !== undefined && image.height !== undefined && image.width >= image.height;

export const chooseLegendImage = (images: readonly LegendImage[], zoom?: number, broken?: ReadonlySet<string>): LegendImage | undefined => {
  const scale = zoom === undefined ? undefined : scaleDenominatorAt(zoom);
  const candidates = images.filter(image => !broken?.has(image.url) && (scale === undefined || appliesAt(image, scale)));
  return candidates.find(isLandscape) ?? candidates[0];
};

export const imageLegends = (layers: readonly LayerControl[], zoom?: number, broken?: ReadonlySet<string>): ImageLegend[] =>
  layers.flatMap(layer => {
    if (!layer.legendImages || !isLayerDrawn(layer)) return [];
    const image = chooseLegendImage(layer.legendImages, zoom, broken);
    return image ? [{ layer, image }] : [];
  });
