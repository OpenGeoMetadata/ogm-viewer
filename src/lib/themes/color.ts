import { rgb } from 'd3-color';

// OKLab matrices: https://bottosson.github.io/posts/oklab/; MapLibre cannot parse CSS relative colors.

const toLinear = (channel: number): number => {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};

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

// Normalize CSS Color 4 space syntax because d3-color only parses the comma form.
const commaSyntax = (color: string): string =>
  color.replace(/^(rgba?|hsla?)\(([^,]*)\)$/i, (whole, fn: string, args: string) => {
    const parts = args.trim().split('/')[0].trim().split(/\s+/);
    return parts.length === 3 ? `${fn}(${parts.join(',').replace(/deg\b/i, '')})` : whole;
  });

export const shiftLightness = (color: string, delta: number): string => {
  const { r, g, b } = rgb(commaSyntax(color));
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return color;

  const [lightness, a, bb] = toOklab(r, g, b);
  const shifted = lightness + delta;

  return toHex(shifted >= 0 && shifted <= 1 ? shifted : lightness - delta, a, bb);
};

export const atLightness = (color: string, lightness: number): string => {
  const { r, g, b } = rgb(commaSyntax(color));
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return color;

  const [, a, bb] = toOklab(r, g, b);
  return toHex(lightness, a, bb);
};

export const contrastColor = (color: string): string => {
  const { r, g, b } = rgb(commaSyntax(color));
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return '';

  const luminance = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  const onBlack = (luminance + 0.05) / 0.05;
  const onWhite = 1.05 / (luminance + 0.05);

  return onBlack > onWhite ? '#000000' : '#ffffff';
};
