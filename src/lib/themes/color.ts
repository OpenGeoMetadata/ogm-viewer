import { rgb } from 'd3-color';

// OKLab, via Björn Ottosson's matrices (https://bottosson.github.io/posts/oklab/). Used rather than
// CSS relative colors because MapLibre's own color parser takes only named colors, hex, rgb() and
// hsl() - an `oklch(from ...)` or `color-mix()` would have to be resolved and serialized back to
// sRGB by the browser before MapLibre would accept it, which needs a probe element in the document
// and a bet on how each engine serializes the result. Doing the arithmetic here needs neither.
//
// OKLab over CIE Lab because Web Awesome's palette is authored in OKLCH, so a shift measured
// against its ramps means the same thing here.

// sRGB channel (0-255) to linear-light
const toLinear = (channel: number): number => {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};

// Linear-light back to an sRGB channel, clamped into gamut. Shifting lightness while holding a and b
// can land outside sRGB; clipping the channel shifts the hue slightly, which is a fair trade for a
// color that only ever draws a one- or two-pixel outline.
const toChannel = (value: number): number => {
  const encoded = value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, encoded)) * 255);
};

const toOklab = (r: number, g: number, b: number): [number, number, number] => {
  const red = toLinear(r);
  const green = toLinear(g);
  const blue = toLinear(b);

  const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);

  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
};

const toHex = (lightness: number, a: number, b: number): string => {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;

  const channels = [
    toChannel(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toChannel(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toChannel(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];

  return `#${channels.map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
};

// d3-color reads the comma forms of rgb()/hsl() but not the space-separated ones CSS Color 4 added,
// which MapLibre itself accepts and a stylesheet author may well have written. Rewrite those to the
// comma form: take the first three components, drop any `/ alpha` (the outline's opacity comes from
// a paint property, not from its color) and the `deg` an author may have put on a hue.
const commaSyntax = (color: string): string =>
  color.replace(/^(rgba?|hsla?)\(([^,]*)\)$/i, (whole, fn: string, args: string) => {
    const parts = args.trim().split('/')[0].trim().split(/\s+/);
    return parts.length === 3 ? `${fn}(${parts.join(',').replace(/deg\b/i, '')})` : whole;
  });

/**
 * The same color at a different perceptual lightness. A positive delta lightens, a negative one
 * darkens, on OKLab's 0-1 scale; hue and chroma are left where they were.
 *
 * A shift that would run off either end of the scale goes the other way by the same amount instead.
 * Darkening something already near black would otherwise return near black again, and the caller
 * asked for a color that can be told apart from the one it passed in.
 *
 * Anything d3-color can't read - an `oklch()` or a `color-mix()` that reached us through a custom
 * property - comes back untouched. That leaves an outline the same color as its fill, which is dull
 * but draws; handing MapLibre a color it can't parse would drop the layer.
 */
export const shiftLightness = (color: string, delta: number): string => {
  const { r, g, b } = rgb(commaSyntax(color));
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return color;

  const [lightness, a, bb] = toOklab(r, g, b);
  const shifted = lightness + delta;

  return toHex(shifted >= 0 && shifted <= 1 ? shifted : lightness - delta, a, bb);
};

/**
 * The same color at a stated perceptual lightness, rather than a step away from wherever it was.
 * Hue and chroma are left where they were, as above.
 *
 * `shiftLightness` answers a different question and can't answer this one. An outline only has to be
 * told apart from the color it outlines, so a step in either direction will do, and which direction
 * depends on the basemap - which is why that one takes a delta and this one takes a destination. A
 * color that has to carry text has to arrive somewhere in particular whatever it started as, and the
 * two mode tokens behind one of ours start at opposite ends of the scale: the same step from each
 * lands them either side of the point where white stops being the more readable ink.
 *
 * Anything d3-color can't read comes back untouched, for the reason above.
 */
export const atLightness = (color: string, lightness: number): string => {
  const { r, g, b } = rgb(commaSyntax(color));
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return color;

  const [, a, bb] = toOklab(r, g, b);
  return toHex(lightness, a, bb);
};

/**
 * Black or white, whichever contrasts more with the color given - the choice CSS `contrast-color()`
 * makes, made here for the reason at the top of this file, and by the measure that function's
 * definition rests on: WCAG relative luminance, whose crossover sits near 0.18 rather than at the
 * mid-gray you would guess.
 *
 * Not `shiftLightness` with a large delta. A halo is not a lighter or darker version of its text -
 * it is the thing the text is read against, and it has to hold up over whatever basemap is under it.
 *
 * Returns the empty string when the color can't be read, rather than the color itself: a halo the
 * same color as its text hides the text, so a caller wants the chance to fall back to something.
 */
export const contrastColor = (color: string): string => {
  const { r, g, b } = rgb(commaSyntax(color));
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return '';

  const luminance = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  const onBlack = (luminance + 0.05) / 0.05;
  const onWhite = 1.05 / (luminance + 0.05);

  return onBlack > onWhite ? '#000000' : '#ffffff';
};
