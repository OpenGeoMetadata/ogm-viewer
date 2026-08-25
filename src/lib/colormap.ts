import { COLORMAP_INDEX, decodeColormapSprite, type ColormapName } from '@developmentseed/deck.gl-raster/gpu-modules';

import { colormapSpriteBase64 } from './assets.generated';

// The color ramps offered for a scalar COG - a single-band raster whose values are read off a ramp
// rather than shown as-is; see src/lib/previewers/cog-pipeline.ts. Twelve of the 107
// @developmentseed/deck.gl-raster ships, not all of them: perceptually-uniform ones first, since
// those are the ones a value can be read off accurately, then a couple of diverging ramps for data
// that has a meaningful zero (anomalies, elevation relative to sea level), then a few sequential
// single-hue ones. `key` is upstream's own name, which flattens case in ways a label shouldn't
// repeat - `rdylbu`, not `RdYlBu` - so every entry pairs it with one written for people.
// `satisfies` rather than a `: readonly {...}[]` annotation, so this stays what it looks like: a
// fixed list of literal strings, each checked against ColormapName without being widened back to
// it. ColorRampName below is exactly those twelve, which is what lets a typo here - or a ramp
// upstream drops - be a compile error instead of a swatch that's silently blank at runtime.
export const COLOR_RAMPS = [
  { key: 'viridis', label: 'Viridis' },
  { key: 'magma', label: 'Magma' },
  { key: 'inferno', label: 'Inferno' },
  { key: 'plasma', label: 'Plasma' },
  { key: 'cividis', label: 'Cividis' },
  { key: 'terrain', label: 'Terrain' },
  { key: 'gist_earth', label: 'Earth' },
  { key: 'spectral', label: 'Spectral' },
  { key: 'rdylbu', label: 'Red-Yellow-Blue' },
  { key: 'rdbu', label: 'Red-Blue' },
  { key: 'blues', label: 'Blues' },
  { key: 'greys', label: 'Greys' },
] as const satisfies readonly { key: ColormapName; label: string }[];

export type ColorRampName = (typeof COLOR_RAMPS)[number]['key'];

export const DEFAULT_COLOR_RAMP: ColorRampName = 'viridis';

// Decoded once per realm and shared: every caller - the previewer building a GPU texture, the layers
// panel drawing swatches, the legend drawing its gradient - wants the same pixels, and decoding needs
// no GPU device, so there's nothing gained by putting it off until one exists. See lerc.ts's load()
// for the same shape of memo.
let sprite: Promise<ImageData> | undefined;

// The sprite every named ramp is a row of - see scripts/inline-assets.mjs for how it gets here, and
// stencil.config.ts's note on the dist-custom-elements target for why this one is compiled in rather
// than published as a file the way lerc's wasm still is.
export function colormapSprite(): Promise<ImageData> {
  sprite ??= decodeColormapSprite(base64ToBytes(colormapSpriteBase64));
  return sprite;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// A handful of CSS colors sampled evenly across one ramp's row of the sprite, for a swatch or a
// legend gradient - not the GPU path, which samples all 256 stops by indexing the sprite as a
// texture directly (see Colormap in cog-pipeline.ts). Six is enough for a `linear-gradient()`, which
// interpolates the rest; more would just be more stops of the same interpolation.
//
// Returns nothing for a name the sprite doesn't have a row for, rather than falling back to some
// other ramp - a swatch that quietly became a different ramp would be a worse bug than a blank one.
export function rampStops(image: ImageData, name: ColormapName, count = 6): string[] {
  const row = COLORMAP_INDEX[name];
  if (row === undefined) return [];

  const stops: string[] = [];
  for (let i = 0; i < count; i++) {
    // Evenly spaced across all 256 columns, including both ends
    const column = count > 1 ? Math.round((i * 255) / (count - 1)) : 0;
    const offset = (row * image.width + column) * 4;
    const [r, g, b] = image.data.subarray(offset, offset + 3);
    stops.push(`rgb(${r} ${g} ${b})`);
  }
  return stops;
}

// A CSS `linear-gradient()` built from rampStops(), for anywhere a ramp needs to be shown rather than
// drawn through - a swatch in the layers panel, the bar in the legend. `90deg` (left to right) reads
// the way a legend's own min-to-max labels do; a caller drawing a legend the other way round is
// responsible for turning the labels to match, not this.
export function rampGradient(image: ImageData, name: ColormapName): string {
  const stops = rampStops(image, name);
  if (stops.length === 0) return 'transparent';
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

// `step` is the spacing between adjacent labels on whatever axis value belongs to - a legend's own
// (max - min), not the value being formatted. It decides two different things below, at opposite
// ends of the range: whether a value near zero needs exponential form at all, and if not, how many
// decimals a fractional one gets.
//
// Above ten thousand, values are abbreviated to K or M rather than ever shown in exponential form:
// geo data commonly runs that high - population, precipitation in mm, elevation in mm - and "1.5M"
// reads better than "1.5e6" ever would. Ten thousand rather than one thousand, because a four-digit
// value is as often a year as a magnitude, and "5,000" is no harder to read at a glance than "5.0K"
// is - the same reasoning apps/geolibre-desktop/src/lib/auto-legend.ts uses (MIT, opengeos/GeoLibre).
//
// Exponential form is reserved for the opposite end: a step under 0.001 is most of a Float32 range
// centered near zero - an elevation anomaly, an NDVI band - where a fixed-point label would either
// run long or round two adjacent ticks to the same "0.000". Derived from the step rather than the
// value for the same reason apps/geolibre-desktop/src/lib/print-layout.ts derives decimal precision
// from it (also GeoLibre, `formatColorbarTick`): two labels a literal 0.01 apart both round to "0.00"
// at a fixed two decimals, which reads as a legend with no range at all.
export function formatValue(value: number, step: number = Math.abs(value)): string {
  const abs = Math.abs(value);

  if (abs !== 0 && step > 0 && step < 0.001) return value.toExponential(1);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 1 })}M`;
  if (abs >= 10_000) return `${(value / 1_000).toLocaleString(undefined, { maximumFractionDigits: 1 })}K`;
  if (Number.isInteger(value)) return value.toLocaleString();

  const decimals = step > 0 ? Math.max(0, Math.min(8, Math.ceil(-Math.log10(step)) + 1)) : 2;
  return value.toLocaleString(undefined, { maximumFractionDigits: decimals });
}
