import { describe, it, expect } from '@stencil/vitest';

import { atLightness, contrastColor, shiftLightness } from './color';
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

      expect(light.getStyle().dataColor).toBe('rebeccapurple');
      expect(dark.getStyle().dataColor).toBe('papayawhip');
    });

    it('prefers an --ogm-* override to the token it falls back to', () => {
      const theme = themed('light', { '--ogm-data-color': '#8f1414', '--wa-color-blue-80': 'rebeccapurple' });

      expect(theme.getStyle().dataColor).toBe('#8f1414');
    });

    // An app that names a color has said it wants that color; picking a different one in dark mode
    // would be picking one it never asked for.
    it('honors a single override in both modes', () => {
      const tokens = { '--ogm-data-color': '#8f1414', '--wa-color-blue-50': 'papayawhip', '--wa-color-blue-80': 'rebeccapurple' };

      expect(themed('light', tokens).getStyle().dataColor).toBe('#8f1414');
      expect(themed('dark', tokens).getStyle().dataColor).toBe('#8f1414');
    });

    // Web Awesome documents its palette tokens inline, and Safari leaks the comment into the
    // computed value, which MapLibre then rejects as an invalid color.
    it('strips a comment left in a token value', () => {
      const theme = themed('light', { '--wa-color-blue-80': '#0a3a1d /* oklch(30% 0.08 150) */' });

      expect(theme.getStyle().dataColor).toBe('#0a3a1d');
    });
  });

  // The outline isn't a second decision an app has to make. Asserted as a relationship to the color
  // it came from rather than against a hex, so the shift can be retuned without rewriting this.
  describe('derived stroke colors', () => {
    const tokens = { '--ogm-data-color': '#8f1414' };

    it('outlines data with a darker version of it in light mode', () => {
      const { dataColor, strokeColor } = themed('light', tokens).getStyle();

      expect(strokeColor).toBe(shiftLightness(dataColor, -0.26));
    });

    // The direction is what flips between modes, so one named color reads on either basemap - which
    // an app naming its own stroke could never get, since that override applies to both modes.
    it('outlines it with a lighter version in dark mode', () => {
      const { dataColor, strokeColor } = themed('dark', tokens).getStyle();

      expect(strokeColor).toBe(shiftLightness(dataColor, 0.26));
      expect(strokeColor).not.toBe(themed('light', tokens).getStyle().strokeColor);
    });

    it('derives each state from its own color rather than from the base one', () => {
      const style = themed('light', { '--ogm-selected-color': '#e98300', '--ogm-invalid-color': '#b1040e' }).getStyle();

      expect(style.strokeSelectedColor).toBe(shiftLightness('#e98300', -0.26));
      expect(style.strokeInvalidColor).toBe(shiftLightness('#b1040e', -0.26));
    });

    it('steps aside for an app that names the outline itself', () => {
      const named = { ...tokens, '--ogm-stroke-color': '#4a0a0a' };

      expect(themed('light', named).getStyle().strokeColor).toBe('#4a0a0a');
      expect(themed('dark', named).getStyle().strokeColor).toBe('#4a0a0a');
    });
  });

  // The disc a result's number sits on is derived to a lightness rather than by a step, because a
  // numeral has to be readable on it in either mode. Asserted as that relationship, and as the
  // guarantee that rests on it, rather than against a hex.
  describe('derived marker colors', () => {
    const tokens = { '--ogm-data-color': '#8f1414', '--ogm-highlight-color': '#e98300' };

    it('sinks a color to the depth a number can be read on', () => {
      const { dataColor, markerColor } = themed('light', tokens).getStyle();

      expect(markerColor).toBe(atLightness(dataColor, 0.45));
    });

    // Which is what a step could not do: the two tokens behind one color start at opposite ends of
    // the scale, so one step from each would land them either side of where white stops being legible.
    it('sinks it to the same depth in both modes', () => {
      const light = themed('light', tokens).getStyle();
      const dark = themed('dark', tokens).getStyle();

      expect(dark.markerColor).toBe(light.markerColor);
    });

    it('derives the highlighted marker from the highlight color', () => {
      const { highlightColor, markerHighlightColor } = themed('light', tokens).getStyle();

      expect(markerHighlightColor).toBe(atLightness(highlightColor, 0.45));
      expect(markerHighlightColor).not.toBe(themed('light', tokens).getStyle().markerColor);
    });

    // What the numeral's own color rests on. It is chosen by contrast at the point of drawing, so a
    // disc that came out pale would put black ink on a map whose other numbers are white. Checked
    // against the palette's own values for each mode - the pale pair a light basemap gets and the
    // saturated pair a dark one does - and against a color pale enough that an app naming it would
    // otherwise get one.
    it('leaves both discs deep enough for white ink', () => {
      const light = themed('light', { '--wa-color-blue-80': '#9fceff', '--wa-color-cyan-80': '#7fd6ec' }).getStyle();
      const dark = themed('dark', { '--wa-color-blue-50': '#0071ec', '--wa-color-cyan-60': '#00a3c0' }).getStyle();
      const pale = themed('light', { '--ogm-data-color': '#ffe08a', '--ogm-highlight-color': '#ffff00' }).getStyle();

      [light, dark, pale].forEach(style => {
        expect(contrastColor(style.markerColor)).toBe('#ffffff');
        expect(contrastColor(style.markerHighlightColor)).toBe('#ffffff');
      });
    });

    it('steps aside for an app that names the disc itself', () => {
      const named = { ...tokens, '--ogm-marker-color': '#4a0a0a', '--ogm-marker-highlight-color': '#7a4600' };
      const style = themed('light', named).getStyle();

      expect(style.markerColor).toBe('#4a0a0a');
      expect(style.markerHighlightColor).toBe('#7a4600');
    });
  });

  // A label's halo is derived like an outline is, but to the opposite end of the scale: it isn't a
  // step away from the text, it's what holds the text apart from the basemap.
  describe('derived text halo', () => {
    it('takes the halo from the text color rather than from the mode', () => {
      expect(themed('light', { '--ogm-text-color': '#101219' }).getStyle().textHaloColor).toBe('#ffffff');
      // Light text in light mode still gets a dark halo - the text is what the halo answers to
      expect(themed('light', { '--ogm-text-color': '#f1f2f3' }).getStyle().textHaloColor).toBe('#000000');
    });

    it('follows the mode by way of the token the text color falls back to', () => {
      const tokens = { '--wa-color-gray-05': '#101219', '--wa-color-gray-95': '#f1f2f3' };

      expect(themed('dark', tokens).getStyle().textHaloColor).toBe('#000000');
      expect(themed('light', tokens).getStyle().textHaloColor).toBe('#ffffff');
    });

    it('steps aside for an app that names the halo itself', () => {
      const named = { '--ogm-text-color': '#101219', '--ogm-text-halo-color': '#8f1414' };

      expect(themed('light', named).getStyle().textHaloColor).toBe('#8f1414');
    });

    // Deriving from a color we can't read would hand back the text color itself and swallow the
    // label, so this is the one case that still reaches for the token pair
    it('falls back to the token when the text color cannot be read', () => {
      const tokens = { '--ogm-text-color': 'oklch(0.5 0.1 20)', '--wa-color-gray-95': '#f1f2f3' };

      expect(themed('light', tokens).getStyle().textHaloColor).toBe('#f1f2f3');
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
      expect(themed('light', { '--ogm-data-opacity': '0.35' }).getStyle().opacity).toBe(0.35);
      expect(themed('light', { '--ogm-bounds-opacity': '0.2' }).getStyle().boundsOpacity).toBe(0.2);
      expect(themed('light', { '--ogm-overview-padding': '96' }).getStyle().overviewPadding).toBe(96);
    });

    it('keeps the default when the property is unset or unparseable', () => {
      expect(themed('light').getStyle().textSize).toBe(14);
      expect(themed('light', { '--ogm-text-size': 'large' }).getStyle().textSize).toBe(14);
      expect(themed('light', { '--ogm-overview-padding': 'var(--wa-space-3xl)' }).getStyle().overviewPadding).toBe(64);
    });

    // A bounding box and an index map say where a record is; they aren't the thing a reader came to
    // look at, so they start below whatever drawn data starts at. Asserted as a relationship rather
    // than as two constants: the point is the ordering, and either default can be retuned.
    it('starts bounds fainter than data by default, and separately from it', () => {
      const { opacity, boundsOpacity } = themed('light').getStyle();

      expect(boundsOpacity).toBeLessThan(opacity);
      // Not derived from it either - raising one leaves the other where the theme put it
      expect(themed('light', { '--ogm-data-opacity': '1' }).getStyle().boundsOpacity).toBe(boundsOpacity);
    });

    // An overview is a whole map read at once rather than a pane filled with one record, so what it
    // frames starts further in than a preview does. A relationship rather than two constants: the
    // point is that there's more room, and either default can be retuned.
    it('leaves more room around an overview than around a preview', () => {
      const theme = themed('light');

      expect(theme.getStyle().overviewPadding).toBeGreaterThan(theme.getPadding());
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
