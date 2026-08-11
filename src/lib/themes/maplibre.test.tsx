import { describe, it, expect } from '@stencil/vitest';

import MapLibreTheme, { darkBasemapStyle, lightBasemapStyle } from './maplibre';

// A theme reading from an element carrying the given custom properties.
//
// The properties go on the element the theme reads rather than on an ancestor: happy-dom resolves a
// custom property declared on the element itself but does not inherit one down the tree. Reaching in
// from an ancestor - which is how an embedding app actually sets these - is CSS inheritance doing its
// job, so it belongs in a browser rather than here.
const themed = (theme: 'light' | 'dark' | undefined, tokens: Record<string, string> = {}) => {
  const el = document.createElement('div');
  Object.entries(tokens).forEach(([name, value]) => el.style.setProperty(name, value));
  document.body.appendChild(el);
  return new MapLibreTheme(el, theme);
};

describe('MapLibreTheme', () => {
  describe('colors', () => {
    it('reads our own token for the mode when nothing overrides it', () => {
      const light = themed('light', { '--wa-color-blue-80': 'rebeccapurple' });
      const dark = themed('dark', { '--wa-color-blue-50': 'papayawhip' });

      expect(light.getStyle().fillColor).toBe('rebeccapurple');
      expect(dark.getStyle().fillColor).toBe('papayawhip');
    });

    it('prefers an --ogm-* override to the token it falls back to', () => {
      const theme = themed('light', { '--ogm-fill-color': '#8f1414', '--wa-color-blue-80': 'rebeccapurple' });

      expect(theme.getStyle().fillColor).toBe('#8f1414');
    });

    // An app that names a color has said it wants that color; picking a different one in dark mode
    // would be picking one it never asked for.
    it('honors a single override in both modes', () => {
      const tokens = { '--ogm-stroke-color': '#4a0a0a', '--wa-color-blue-50': 'papayawhip', '--wa-color-blue-80': 'rebeccapurple' };

      expect(themed('light', tokens).getStyle().strokeColor).toBe('#4a0a0a');
      expect(themed('dark', tokens).getStyle().strokeColor).toBe('#4a0a0a');
    });

    // Web Awesome documents its palette tokens inline, and Safari leaks the comment into the
    // computed value, which MapLibre then rejects as an invalid color.
    it('strips a comment left in a token value', () => {
      const theme = themed('light', { '--wa-color-blue-80': '#0a3a1d /* oklch(30% 0.08 150) */' });

      expect(theme.getStyle().fillColor).toBe('#0a3a1d');
    });
  });

  // MapLibre's text-font names a glyph the basemap style serves, not a CSS font stack, so this one
  // must not fall through to --wa-font-family-body the way the colors fall through to their tokens.
  describe('label font', () => {
    it('defaults to a glyph name rather than a CSS font stack', () => {
      const theme = themed('light', { '--wa-font-family-body': 'ui-sans-serif, system-ui, sans-serif' });

      expect(theme.getStyle().textFont).toBe('Noto Sans Regular');
    });

    it('takes an override', () => {
      expect(themed('light', { '--ogm-font-family': 'Open Sans Regular' }).getStyle().textFont).toBe('Open Sans Regular');
    });
  });

  describe('numbers', () => {
    it('reads an override', () => {
      expect(themed('light', { '--ogm-text-size': '18' }).getStyle().textSize).toBe(18);
      expect(themed('light', { '--ogm-fill-opacity': '0.35' }).getStyle().opacity).toBe(0.35);
      expect(themed('light', { '--ogm-bounds-opacity': '0.2' }).getStyle().boundsOpacity).toBe(0.2);
    });

    it('keeps the default when the property is unset or unparseable', () => {
      expect(themed('light').getStyle().textSize).toBe(14);
      expect(themed('light', { '--ogm-text-size': 'large' }).getStyle().textSize).toBe(14);
    });

    // A bounding box and an index map say where a record is; they aren't the thing a reader came to
    // look at, so they start below whatever drawn data starts at. Asserted as a relationship rather
    // than as two constants: the point is the ordering, and either default can be retuned.
    it('starts bounds fainter than data by default, and separately from it', () => {
      const { opacity, boundsOpacity } = themed('light').getStyle();

      expect(boundsOpacity).toBeLessThan(opacity);
      // Not derived from it either - raising one leaves the other where the theme put it
      expect(themed('light', { '--ogm-fill-opacity': '1' }).getStyle().boundsOpacity).toBe(boundsOpacity);
    });
  });

  describe('basemap', () => {
    // The component's own answer, not the computed color-scheme: the stylesheet that would set that
    // is linked inside a shadow root, and may not have loaded when the map is first built.
    it('follows the theme it was given', () => {
      expect(themed('dark').getBaseMapStyle()).toBe(darkBasemapStyle);
      expect(themed('light').getBaseMapStyle()).toBe(lightBasemapStyle);
    });

    it('falls back to the computed color-scheme when it was given no theme', () => {
      const el = document.createElement('div');
      el.style.setProperty('color-scheme', 'dark');
      document.body.appendChild(el);

      expect(new MapLibreTheme(el).getBaseMapStyle()).toBe(darkBasemapStyle);
      expect(new MapLibreTheme(document.createElement('div')).getBaseMapStyle()).toBe(lightBasemapStyle);
    });
  });
});
