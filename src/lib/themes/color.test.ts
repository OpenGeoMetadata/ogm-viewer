import { describe, it, expect } from '@stencil/vitest';

import { atLightness, contrastColor, shiftLightness } from './color';

// Perceptual lightness of a hex color, on the 0-1 scale shiftLightness works in. Reimplemented here
// rather than exported from the module under test, so an error in its conversion can't cancel out.
const lightness = (hex: string): number => {
  const channels = [1, 3, 5].map(i => {
    const value = parseInt(hex.slice(i, i + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const [r, g, b] = channels;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
};

describe('shiftLightness', () => {
  it('darkens on a negative delta and lightens on a positive one', () => {
    const blue = '#3178c0';

    expect(lightness(shiftLightness(blue, -0.26))).toBeLessThan(lightness(blue));
    expect(lightness(shiftLightness(blue, 0.26))).toBeGreaterThan(lightness(blue));
  });

  // On a neutral, where there is no chroma to hold and so nothing to clip. A saturated color asked
  // to get lighter runs out of sRGB first and lands a little short, which is the cost of holding
  // its hue - see the gamut note in the module.
  it('moves lightness by the amount asked for', () => {
    expect(lightness(shiftLightness('#808080', 0.26))).toBeCloseTo(lightness('#808080') + 0.26, 2);
    expect(lightness(shiftLightness('#808080', -0.26))).toBeCloseTo(lightness('#808080') - 0.26, 2);
  });

  it('leaves a color where it is on a zero delta', () => {
    expect(shiftLightness('#3178c0', 0)).toBe('#3178c0');
  });

  // Not exact: holding a and b while lightness moves can land outside sRGB, and clipping the
  // channel back into gamut pulls the hue with it. Close is what an outline needs.
  it('keeps the hue recognizable', () => {
    const shifted = shiftLightness('#3178c0', -0.2);
    const [r, g, b] = [1, 3, 5].map(i => parseInt(shifted.slice(i, i + 2), 16));

    expect(b).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(r);
  });

  // Darkening something already near black would hand back something near black, and the caller
  // wanted a color it could tell apart from the one it passed in.
  it('shifts the other way rather than running off the end of the scale', () => {
    expect(lightness(shiftLightness('#0a0a0a', -0.26))).toBeGreaterThan(lightness('#0a0a0a'));
    expect(lightness(shiftLightness('#f5f5f5', 0.26))).toBeLessThan(lightness('#f5f5f5'));
  });

  // Whatever an app puts in a custom property arrives here as whatever CSS computed it to
  it('reads the color forms MapLibre itself accepts', () => {
    const fromHex = shiftLightness('#663399', -0.2);

    expect(shiftLightness('rebeccapurple', -0.2)).toBe(fromHex);
    expect(shiftLightness('rgb(102, 51, 153)', -0.2)).toBe(fromHex);
    expect(shiftLightness('#639', -0.2)).toBe(fromHex);
  });

  // d3-color reads only the comma forms; these are the ones CSS Color 4 added
  it('reads space-separated rgb() and hsl() too', () => {
    expect(shiftLightness('rgb(102 51 153)', -0.2)).toBe(shiftLightness('#663399', -0.2));
    expect(shiftLightness('rgb(102 51 153 / 50%)', -0.2)).toBe(shiftLightness('#663399', -0.2));
    expect(shiftLightness('hsl(270deg 50% 40%)', -0.2)).toBe(shiftLightness('hsl(270, 50%, 40%)', -0.2));
  });

  // Handing MapLibre a color it can't parse would drop the layer; an outline that matches its fill
  // is dull, but it draws.
  it('hands back anything it cannot read, untouched', () => {
    expect(shiftLightness('oklch(0.5 0.1 20)', -0.26)).toBe('oklch(0.5 0.1 20)');
    expect(shiftLightness('color-mix(in oklab, red, blue)', -0.26)).toBe('color-mix(in oklab, red, blue)');
    expect(shiftLightness('', -0.26)).toBe('');
  });
});

describe('atLightness', () => {
  // To within what eight bits a channel can hold: the answer is a hex color, and reading its
  // lightness back off three rounded channels is worth about a thousandth either way.
  it('lands on the lightness it was given, wherever it started', () => {
    expect(lightness(atLightness('#9fceff', 0.45))).toBeCloseTo(0.45, 2);
    expect(lightness(atLightness('#7fd6ec', 0.6))).toBeCloseTo(0.6, 2);
  });

  // Holding a hue and its chroma while moving the lightness can land outside sRGB, and clipping the
  // channel back into it costs a little of the lightness that was asked for. The same trade
  // shiftLightness documents, and it only shows on the colors with the most chroma in them.
  it('gets as close as sRGB allows for a color with no room left', () => {
    expect(lightness(atLightness('#0071ec', 0.45))).toBeCloseTo(0.45, 1);
  });

  // Which is the whole point of taking a destination rather than a step: the two tokens behind one of
  // our colors sit at opposite ends of the scale, and both have to end up somewhere a numeral reads.
  it('brings a pair of light and dark colors to the same place', () => {
    const pale = atLightness('#9fceff', 0.45);
    const deep = atLightness(shiftLightness('#9fceff', 0.3), 0.45);

    expect(lightness(pale)).toBeCloseTo(lightness(deep), 2);
  });

  it('keeps the hue it was given', () => {
    // Still a blue, and still nearer blue than the red it isn't
    const [r, g, b] = [1, 3, 5].map(i => parseInt(atLightness('#9fceff', 0.45).slice(i, i + 2), 16));
    expect(b).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(r);
  });

  // What the disc behind a result's number rests on. Asserted against every color the palette can
  // hand over, plus what an app is likely to name, because the numeral's own color is chosen by
  // contrast and a disc that came out pale would put black ink on a map full of white ink.
  it('lands deep enough for white ink, whatever color it was given', () => {
    const colors = ['#9fceff', '#0071ec', '#7fd6ec', '#00a3c0', '#93da98', '#00883c', '#f3676c', '#dc3146', '#ffe08a', '#ffff00', '#ffffff', '#000000'];

    colors.forEach(color => expect(contrastColor(atLightness(color, 0.45))).toBe('#ffffff'));
  });

  it('hands back anything it cannot read, untouched', () => {
    expect(atLightness('oklch(0.5 0.1 20)', 0.45)).toBe('oklch(0.5 0.1 20)');
    expect(atLightness('', 0.45)).toBe('');
  });
});

describe('contrastColor', () => {
  it('goes dark against a light color and light against a dark one', () => {
    expect(contrastColor('#f1f2f3')).toBe('#000000');
    expect(contrastColor('#101219')).toBe('#ffffff');
  });

  // Not a step away from the color, the way an outline is: it is the other end of the scale, so a
  // label holds up over whatever the basemap puts behind it
  it('goes to the end of the scale rather than a step along it', () => {
    expect(contrastColor('#8f1414')).toBe('#ffffff');
    expect(contrastColor('#f1c40f')).toBe('#000000');
  });

  // Relative luminance is weighted toward green, so the crossover sits well below the mid-gray a
  // straight lightness reading would put it at
  it('crosses over by luminance, not by mid-gray', () => {
    expect(contrastColor('#717584')).toBe('#ffffff');
    expect(contrastColor('#00ff00')).toBe('#000000');
    expect(contrastColor('#0000ff')).toBe('#ffffff');
  });

  it('reads the same color forms shiftLightness does', () => {
    expect(contrastColor('white')).toBe('#000000');
    expect(contrastColor('rgb(16 18 25)')).toBe('#ffffff');
  });

  // A halo the same color as its text would hide the label, so this says nothing rather than
  // guessing, and leaves the caller to fall back
  it('gives no answer for a color it cannot read', () => {
    expect(contrastColor('oklch(0.5 0.1 20)')).toBe('');
    expect(contrastColor('')).toBe('');
  });
});
