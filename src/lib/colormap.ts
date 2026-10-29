import { COLORMAP_INDEX, decodeColormapSprite, type ColormapName } from '@developmentseed/deck.gl-raster/gpu-modules';

import { colormapSpriteBase64 } from './assets.generated';

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

let sprite: Promise<ImageData> | undefined;

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

export function rampStops(image: ImageData, name: ColormapName, count = 6): string[] {
  const row = COLORMAP_INDEX[name];
  if (row === undefined) return [];

  const stops: string[] = [];
  for (let i = 0; i < count; i++) {
    const column = count > 1 ? Math.round((i * 255) / (count - 1)) : 0;
    const offset = (row * image.width + column) * 4;
    const [r, g, b] = image.data.subarray(offset, offset + 3);
    stops.push(`rgb(${r} ${g} ${b})`);
  }
  return stops;
}

export function rampGradient(image: ImageData, name: ColormapName): string {
  const stops = rampStops(image, name);
  if (stops.length === 0) return 'transparent';
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

// Derive tick precision from spacing so adjacent labels stay distinct.
// Credit: opengeos/GeoLibre auto-legend.ts and print-layout.ts (MIT).
export function formatValue(value: number, step: number = Math.abs(value)): string {
  const abs = Math.abs(value);

  if (abs !== 0 && step > 0 && step < 0.001) return value.toExponential(1);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 1 })}M`;
  if (abs >= 10_000) return `${(value / 1_000).toLocaleString(undefined, { maximumFractionDigits: 1 })}K`;
  if (Number.isInteger(value)) return value.toLocaleString();

  const decimals = step > 0 ? Math.max(0, Math.min(8, Math.ceil(-Math.log10(step)) + 1)) : 2;
  return value.toLocaleString(undefined, { maximumFractionDigits: decimals });
}
