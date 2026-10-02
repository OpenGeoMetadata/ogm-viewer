import { describe, it, expect } from '@stencil/vitest';

import { chooseLegendImage, imageLegends, scaleDenominatorAt, type LegendImage } from './legend';
import type { LayerControl } from './layers';

// The pair NASA GIBS publishes for every colormapped layer, in the order it lists them
const HORIZONTAL: LegendImage = {
  url: 'https://gibs.earthdata.nasa.gov/legends/GHRSST_Sea_Surface_Temperature_H.svg',
  format: 'image/svg+xml',
  width: 378,
  height: 86,
};
const VERTICAL: LegendImage = { ...HORIZONTAL, url: 'https://gibs.earthdata.nasa.gov/legends/GHRSST_Sea_Surface_Temperature_V.svg', width: 135, height: 288 };

// A service that draws its key differently at either end of the scale range, the way a WMTS legend
// can be limited to scales: one picture from 1:1,000,000 out, the other closer in than that
const SMALL_SCALE: LegendImage = { url: 'https://example.org/legend/overview.png', format: 'image/png', minScaleDenominator: 1_000_000 };
const LARGE_SCALE: LegendImage = { url: 'https://example.org/legend/detail.png', format: 'image/png', maxScaleDenominator: 1_000_000 };

describe('scaleDenominatorAt', () => {
  // GoogleMapsCompatible's level 1, as GIBS's capabilities publish it: its 256-pixel tiles draw the
  // world 512 pixels wide, which is what MapLibre draws at zoom 0
  it("matches the scale a WMTS tile matrix publishes for MapLibre's zoom 0", () => {
    expect(scaleDenominatorAt(0)).toBeCloseTo(279541132.0143589, 4);
  });

  it('halves with each zoom in', () => {
    expect(scaleDenominatorAt(3)).toBeCloseTo(279541132.0143589 / 8, 4);
    expect(scaleDenominatorAt(10.5)).toBeCloseTo(scaleDenominatorAt(10) / Math.SQRT2, 4);
  });
});

describe('chooseLegendImage', () => {
  // The panel the legend goes in is a strip across the bottom corner of the map
  it('prefers the wide picture of a pair, whichever the service listed first', () => {
    expect(chooseLegendImage([HORIZONTAL, VERTICAL], 3)).toBe(HORIZONTAL);
    expect(chooseLegendImage([VERTICAL, HORIZONTAL], 3)).toBe(HORIZONTAL);
  });

  // GIBS's keys to a classified layer are 135px square in both of its shapes
  it('takes a square picture as wide enough', () => {
    const square = { ...HORIZONTAL, width: 135, height: 135 };
    expect(chooseLegendImage([square, { ...VERTICAL, width: 135, height: 135 }], 3)).toBe(square);
  });

  it("falls back to the service's own order when it gives no sizes to choose by", () => {
    const unsized = [{ url: 'https://example.org/a.png' }, { url: 'https://example.org/b.png' }];
    expect(chooseLegendImage(unsized, 3)).toBe(unsized[0]);
  });

  it('shows a tall picture when it is the only one there is', () => {
    expect(chooseLegendImage([VERTICAL], 3)).toBe(VERTICAL);
  });

  it('chooses by the scale the map is at', () => {
    const images = [SMALL_SCALE, LARGE_SCALE];

    // About 1:4,400,000 and 1:68,000
    expect(chooseLegendImage(images, 6)).toBe(SMALL_SCALE);
    expect(chooseLegendImage(images, 12)).toBe(LARGE_SCALE);
  });

  // WMTS counts a legend's minimum scale denominator in and its maximum out, so two pictures that
  // meet at a scale never both claim it
  it('counts the minimum scale in and the maximum out', () => {
    const boundary = scaleDenominatorAt(8);
    const outer = { ...SMALL_SCALE, minScaleDenominator: boundary };
    const inner = { ...LARGE_SCALE, maxScaleDenominator: boundary };

    expect(chooseLegendImage([inner, outer], 8)).toBe(outer);
    expect(chooseLegendImage([inner], 8)).toBeUndefined();
  });

  it('has nothing to show at a scale none of the pictures describes', () => {
    expect(chooseLegendImage([LARGE_SCALE], 3)).toBeUndefined();
  });

  it('considers every picture when there is no map to take a scale from', () => {
    expect(chooseLegendImage([LARGE_SCALE])).toBe(LARGE_SCALE);
  });

  it("passes over a picture that wouldn't load for the next one", () => {
    expect(chooseLegendImage([HORIZONTAL, VERTICAL], 3, new Set([HORIZONTAL.url]))).toBe(VERTICAL);
    expect(chooseLegendImage([HORIZONTAL, VERTICAL], 3, new Set([HORIZONTAL.url, VERTICAL.url]))).toBeUndefined();
  });

  it('has nothing to show for a layer with no pictures', () => {
    expect(chooseLegendImage([], 3)).toBeUndefined();
  });
});

const row = (id: string, overrides: Partial<LayerControl> = {}): LayerControl => ({ id, title: id, visible: true, opacity: 1, ...overrides });

describe('imageLegends', () => {
  it('pairs each drawn layer that has a legend with the picture to show for it', () => {
    const temperature = row('temperature', { legendImages: [HORIZONTAL, VERTICAL] });
    expect(imageLegends([row('coastlines'), temperature], 3)).toEqual([{ layer: temperature, image: HORIZONTAL }]);
  });

  // A hidden layer has nothing on screen for its legend to explain
  it('leaves out a layer that is hidden or faded all the way out', () => {
    const hidden = row('hidden', { visible: false, legendImages: [HORIZONTAL] });
    const faded = row('faded', { opacity: 0, legendImages: [HORIZONTAL] });
    expect(imageLegends([hidden, faded], 3)).toEqual([]);
  });

  it('leaves out a layer none of whose pictures describes the scale the map is at', () => {
    expect(imageLegends([row('detail', { legendImages: [LARGE_SCALE] })], 3)).toEqual([]);
  });

  it("leaves out a layer whose pictures wouldn't load", () => {
    expect(imageLegends([row('temperature', { legendImages: [HORIZONTAL] })], 3, new Set([HORIZONTAL.url]))).toEqual([]);
  });
});
