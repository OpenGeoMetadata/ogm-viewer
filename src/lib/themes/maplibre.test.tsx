import { describe, it, expect } from '@stencil/vitest';

import { atLightness, contrastColor, shiftLightness } from './color';
import MapLibreTheme, { darkBasemapStyle, lightBasemapStyle } from './maplibre';

const themed = (theme: 'light' | 'dark' | undefined, tokens: Record<string, string> = {}, basemaps?: { darkBasemap?: string; lightBasemap?: string }) => {
  const el = document.createElement('div');
  Object.entries(tokens).forEach(([name, value]) => el.style.setProperty(name, value));
  document.body.appendChild(el);
  return new MapLibreTheme(el, theme, basemaps);
};

describe('MapLibreTheme', () => {
  describe('colors', () => {
    it('falls back to our own default for the mode when nothing overrides it', () => {
      expect(themed('light').getStyle().dataColor).toBe('#9fceff');
      expect(themed('dark').getStyle().dataColor).toBe('#0071ec');
    });

    it('prefers an --ogm-* override to the default it falls back to', () => {
      const theme = themed('light', { '--ogm-data-color': '#8f1414' });

      expect(theme.getStyle().dataColor).toBe('#8f1414');
    });

    it('honors a single override in both modes', () => {
      const tokens = { '--ogm-data-color': '#8f1414' };

      expect(themed('light', tokens).getStyle().dataColor).toBe('#8f1414');
      expect(themed('dark', tokens).getStyle().dataColor).toBe('#8f1414');
    });

    it('strips a comment left in an override value', () => {
      const theme = themed('light', { '--ogm-data-color': '#0a3a1d /* oklch(30% 0.08 150) */' });

      expect(theme.getStyle().dataColor).toBe('#0a3a1d');
    });
  });

  describe('derived stroke colors', () => {
    const tokens = { '--ogm-data-color': '#8f1414' };

    it('outlines data with a darker version of it in light mode', () => {
      const { dataColor, strokeColor } = themed('light', tokens).getStyle();

      expect(strokeColor).toBe(shiftLightness(dataColor, -0.26));
    });

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

  describe('derived marker colors', () => {
    const tokens = { '--ogm-data-color': '#8f1414', '--ogm-highlight-color': '#e98300' };

    it('sinks a color to the depth a number can be read on', () => {
      const { dataColor, markerColor } = themed('light', tokens).getStyle();

      expect(markerColor).toBe(atLightness(dataColor, 0.7));
    });

    it('sinks it to the same depth in both modes', () => {
      const light = themed('light', tokens).getStyle();
      const dark = themed('dark', tokens).getStyle();

      expect(dark.markerColor).toBe(light.markerColor);
    });

    it('derives the highlighted marker from the highlight color', () => {
      const { highlightColor, markerHighlightColor } = themed('light', tokens).getStyle();

      expect(markerHighlightColor).toBe(atLightness(highlightColor, 0.7));
      expect(markerHighlightColor).not.toBe(themed('light', tokens).getStyle().markerColor);
    });

    it('leaves both discs bright enough for black ink', () => {
      const light = themed('light').getStyle();
      const dark = themed('dark').getStyle();
      const saturated = themed('light', { '--ogm-data-color': '#0000ff', '--ogm-highlight-color': '#4b0082' }).getStyle();

      [light, dark, saturated].forEach(style => {
        expect(contrastColor(style.markerColor)).toBe('#000000');
        expect(contrastColor(style.markerHighlightColor)).toBe('#000000');
      });
    });

    it('steps aside for an app that names the disc itself', () => {
      const named = { ...tokens, '--ogm-marker-color': '#4a0a0a', '--ogm-marker-highlight-color': '#7a4600' };
      const style = themed('light', named).getStyle();

      expect(style.markerColor).toBe('#4a0a0a');
      expect(style.markerHighlightColor).toBe('#7a4600');
    });
  });

  describe('marker font', () => {
    it('takes the page’s own body font, and an override before it', () => {
      expect(themed('light', { '--wa-font-family-body': 'Untitled Sans, sans-serif' }).getStyle().markerFont).toBe('Untitled Sans, sans-serif');
      expect(themed('light', { '--wa-font-family-body': 'Untitled Sans, sans-serif', '--ogm-marker-font': 'Redaction, serif' }).getStyle().markerFont).toBe('Redaction, serif');
    });

    it('falls back to something a browser will certainly have', () => {
      expect(themed('light').getStyle().markerFont).toBe('system-ui, sans-serif');
    });
  });

  describe('derived text halo', () => {
    it('takes the halo from the text color rather than from the mode', () => {
      expect(themed('light', { '--ogm-text-color': '#101219' }).getStyle().textHaloColor).toBe('#ffffff');
      expect(themed('light', { '--ogm-text-color': '#f1f2f3' }).getStyle().textHaloColor).toBe('#000000');
    });

    it('follows the mode by way of the default the text color falls back to', () => {
      expect(themed('dark').getStyle().textHaloColor).toBe('#000000');
      expect(themed('light').getStyle().textHaloColor).toBe('#ffffff');
    });

    it('steps aside for an app that names the halo itself', () => {
      const named = { '--ogm-text-color': '#101219', '--ogm-text-halo-color': '#8f1414' };

      expect(themed('light', named).getStyle().textHaloColor).toBe('#8f1414');
    });

    it('falls back to the default when the text color cannot be read', () => {
      const tokens = { '--ogm-text-color': 'oklch(0.5 0.1 20)' };

      expect(themed('light', tokens).getStyle().textHaloColor).toBe('#f1f2f3');
    });
  });

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

    it('starts bounds fainter than data by default, and separately from it', () => {
      const { opacity, boundsOpacity } = themed('light').getStyle();

      expect(boundsOpacity).toBeLessThan(opacity);
      expect(themed('light', { '--ogm-data-opacity': '1' }).getStyle().boundsOpacity).toBe(boundsOpacity);
    });

    it('leaves more room around an overview than around a preview', () => {
      const theme = themed('light');

      expect(theme.getStyle().overviewPadding).toBeGreaterThan(theme.getPadding());
    });
  });

  describe('basemap', () => {
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

    it('prefers an app’s own basemap for the mode it named one for', () => {
      const custom = themed('dark', {}, { darkBasemap: 'https://example.com/dark.json', lightBasemap: 'https://example.com/light.json' });
      expect(custom.getBaseMapStyle()).toBe('https://example.com/dark.json');

      custom.theme = 'light';
      expect(custom.getBaseMapStyle()).toBe('https://example.com/light.json');
    });

    it('falls back to our own default for a mode nothing was named for', () => {
      const custom = themed('dark', {}, { lightBasemap: 'https://example.com/light.json' });

      expect(custom.getBaseMapStyle()).toBe(darkBasemapStyle);
    });
  });
});
