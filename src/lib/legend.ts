import { isLayerDrawn, type LayerControl } from './layers';

// One discrete color in a map legend. Kept apart from color ramps: a ramp describes a numeric
// range belonging to a layer, while these describe named states whose colors come from a previewer's
// theme (an available index-map sheet, an unavailable one, and the selected sheet, for example).
export type LegendEntry = {
  label: string;
  color: string;
};

// A picture of a layer's key that the service drawing the layer publishes alongside it
export type LegendImage = {
  url: string;
  // The media type the service says it's in, e.g. image/png or image/svg+xml
  format?: string;
  width?: number;
  height?: number;
  // The scales the picture describes the layer at, as denominators: from minScaleDenominator,
  // inclusive, up to maxScaleDenominator, exclusive - the way WMTS defines them. An absent limit is
  // no limit, which is common.
  minScaleDenominator?: number;
  maxScaleDenominator?: number;
};

export type ImageLegend = {
  layer: LayerControl;
  image: LegendImage;
};

// What OGC services take a screen pixel to measure when they turn a resolution into a scale, in
// meters, whatever the screen really is
const STANDARD_PIXEL_SIZE = 0.00028;

// The length of the equator in Web Mercator's own meters
const EQUATOR = 2 * Math.PI * 6378137;

// The scale denominator a Web Mercator map is drawn at, at one of MapLibre's zoom levels, counted the
// way a WMTS tile matrix counts its own: along the equator rather than at the latitude in view, since
// that is what a service's scale limits are written against. MapLibre draws the world 512 pixels wide
// at zoom 0, and each zoom halves the ground a pixel covers.
export const scaleDenominatorAt = (zoom: number): number => EQUATOR / (512 * 2 ** zoom) / STANDARD_PIXEL_SIZE;

// Whether a picture describes the layer at a scale
const appliesAt = (image: LegendImage, scale: number): boolean =>
  (image.minScaleDenominator === undefined || scale >= image.minScaleDenominator) && (image.maxScaleDenominator === undefined || scale < image.maxScaleDenominator);

// At least as wide as it is tall
const isLandscape = (image: LegendImage): boolean => image.width !== undefined && image.height !== undefined && image.width >= image.height;

/**
 * Which of a layer's legend pictures to show: one for the scale the map is at, landscape if there is a
 * choice of shapes, and otherwise the first the service listed. Undefined when none of them applies.
 *
 * `broken` is the pictures that wouldn't load, which are passed over for whatever comes next - the
 * other shape, if the service offered two. `zoom` is undefined only for a legend drawn without a map
 * behind it, which has no scale to choose by, so every picture is a candidate then.
 */
export const chooseLegendImage = (images: readonly LegendImage[], zoom?: number, broken?: ReadonlySet<string>): LegendImage | undefined => {
  const scale = zoom === undefined ? undefined : scaleDenominatorAt(zoom);
  const candidates = images.filter(image => !broken?.has(image.url) && (scale === undefined || appliesAt(image, scale)));
  return candidates.find(isLandscape) ?? candidates[0];
};

// Which of a panel's rows a legend has a picture to show for, and the picture
export const imageLegends = (layers: readonly LayerControl[], zoom?: number, broken?: ReadonlySet<string>): ImageLegend[] =>
  layers.flatMap(layer => {
    if (!layer.legendImages || !isLayerDrawn(layer)) return [];
    const image = chooseLegendImage(layer.legendImages, zoom, broken);
    return image ? [{ layer, image }] : [];
  });
