import { describe, it, expect, vi, afterEach } from 'vitest';

import type { ColormapName } from '@developmentseed/deck.gl-raster/gpu-modules';

import { formatValue, rampGradient, rampStops } from './colormap';

const { decodeColormapSprite } = vi.hoisted(() => ({
  decodeColormapSprite: vi.fn(async (_bytes: Uint8Array) => ({ width: 256, height: 107, data: new Uint8ClampedArray(256 * 107 * 4) })),
}));
vi.mock('@developmentseed/deck.gl-raster/gpu-modules', async importOriginal => ({ ...(await importOriginal()), decodeColormapSprite }));

const SPRITE_WIDTH = 256;
const SPRITE_HEIGHT = 107;
const syntheticSprite = (): ImageData => {
  const data = new Uint8ClampedArray(SPRITE_WIDTH * SPRITE_HEIGHT * 4);
  for (let row = 0; row < SPRITE_HEIGHT; row++) {
    for (let col = 0; col < SPRITE_WIDTH; col++) {
      const offset = (row * SPRITE_WIDTH + col) * 4;
      data.set([row, col, 255 - col, 255], offset);
    }
  }
  return { width: SPRITE_WIDTH, height: SPRITE_HEIGHT, data, colorSpace: 'srgb' } as ImageData;
};

describe('colormapSprite', () => {
  afterEach(() => {
    vi.resetModules();
    decodeColormapSprite.mockClear();
  });

  it('decodes the compiled-in sprite back to the original PNG bytes', async () => {
    const { colormapSprite } = await import('./colormap');
    await colormapSprite();

    const bytes = decodeColormapSprite.mock.calls[0][0] as Uint8Array;
    expect([...bytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(new DataView(bytes.buffer, bytes.byteOffset).getUint32(16)).toEqual(256);
  });

  it('decodes once however many times it is asked', async () => {
    const { colormapSprite } = await import('./colormap');

    await Promise.all([colormapSprite(), colormapSprite()]);

    expect(decodeColormapSprite).toHaveBeenCalledTimes(1);
  });
});

describe('rampStops', () => {
  it("samples a named ramp's own row, evenly across its width", () => {
    expect(rampStops(syntheticSprite(), 'viridis', 3)).toEqual(['rgb(100 0 255)', 'rgb(100 128 127)', 'rgb(100 255 0)']);
  });

  it("samples a different ramp's own row, not another one's", () => {
    expect(rampStops(syntheticSprite(), 'greys', 1)).toEqual(['rgb(40 0 255)']);
  });

  it('answers nothing for a name the sprite has no row for', () => {
    expect(rampStops(syntheticSprite(), 'not-a-real-ramp' as ColormapName)).toEqual([]);
  });
});

describe('rampGradient', () => {
  it('builds a left-to-right CSS gradient from the same stops rampStops would give', () => {
    expect(rampGradient(syntheticSprite(), 'greys')).toEqual(
      'linear-gradient(90deg, rgb(40 0 255), rgb(40 51 204), rgb(40 102 153), rgb(40 153 102), rgb(40 204 51), rgb(40 255 0))',
    );
  });

  it('is transparent for a ramp with no stops, rather than an empty gradient', () => {
    expect(rampGradient(syntheticSprite(), 'not-a-real-ramp' as ColormapName)).toEqual('transparent');
  });
});

describe('formatValue', () => {
  it('rounds to whole numbers when the gap between labels is that coarse', () => {
    expect(formatValue(-184.48, 791.75)).toEqual('-184');
    expect(formatValue(607.27, 791.75)).toEqual('607');
  });

  it('leaves a four-digit whole number alone', () => {
    expect(formatValue(5000)).toEqual('5,000');
  });

  it('abbreviates from ten thousand, and again from a million', () => {
    expect(formatValue(50_000)).toEqual('50K');
    expect(formatValue(1_500_000)).toEqual('1.5M');
  });

  it('falls back to exponential form when the gap between labels is that fine', () => {
    expect(formatValue(0.0005, 0.0005)).toEqual('5.0e-4');
  });

  it('gives a narrow range more decimals than a wide one', () => {
    expect(formatValue(0.15, 0.3)).toEqual('0.15');
    expect(formatValue(0.15, 3000)).toEqual('0');
  });

  it('treats zero as the whole number it is', () => {
    expect(formatValue(0, 0)).toEqual('0');
  });
});
