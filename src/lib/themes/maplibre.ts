import type { SkySpecification } from 'maplibre-gl';

import Theme from './theme';

export type MapLibreStyle = {
  // Generic properties used for all data
  opacity: number;
  // CSS colors used for polygons & circles
  fillColor: string;
  fillHighlightColor: string;
  fillSelectedColor: string;
  fillInvalidColor: string;
  // CSS colors used for lines & polygon/circle borders
  strokeColor: string;
  strokeHighlightColor: string;
  strokeSelectedColor: string;
  strokeInvalidColor: string;
  // CSS text styles for labels
  textColor: string;
  textHaloColor: string;
  textFont: string;
  textSize: number;
  // Opacity for highlighted polygons/circles
  fillHighlightOpacity: number;
  // Initial opacity for a preview that says where a record is rather than showing its data: a
  // bounding box, or an index map's sheet boundaries. Below `opacity`, because neither is what a
  // reader came to look at, and both would otherwise cover the basemap they're being placed against.
  boundsOpacity: number;
};

// URLs to MapLibre style documents for basemaps
export const darkBasemapStyle = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
export const lightBasemapStyle = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

// Default MapLibre `text-font` glyph name. Unlike the rest of our text styling, this can't fall
// back to a CSS token: `text-font` names a glyph MapLibre requests from the style's glyphs
// endpoint, not a CSS font stack, so `--wa-font-family-body` (e.g. "ui-sans-serif, system-ui,
// sans-serif") would be sent to the endpoint literally and rejected by CORS. "Noto Sans Regular"
// is in every fontstack both CARTO basemap styles above serve glyphs for.
const defaultGlyphFont = 'Noto Sans Regular';

// Style properties common to all MapLibre-based previewers
export default class MapLibreTheme extends Theme {
  /**
   * How previewed data is drawn. Every value here can be overridden by setting the matching
   * `--ogm-*` custom property on the component or anything above it - custom properties inherit
   * through shadow boundaries, so setting them on the embedding page reaches in:
   *
   *   ogm-viewer { --ogm-fill-color: #8f1414; --ogm-stroke-color: #4a0a0a; }
   *
   * Left alone, each falls back to a Web Awesome token, picked for the current mode. Those are the
   * library's own palette and move with it; the `--ogm-*` names are the contract, and are the only
   * ones an embedding app should be naming.
   *
   * `--ogm-font-family` is the one exception: it names a MapLibre glyph font (e.g. "Noto Sans
   * Regular"), not a CSS font stack, so it can't fall back to `--wa-font-family-body` - that's a
   * CSS stack like "ui-sans-serif, system-ui, sans-serif", and MapLibre would request it verbatim
   * from the style's glyphs endpoint and get a CORS failure. An app overriding it must give a
   * glyph name the active basemap style actually serves.
   */
  getStyle(): MapLibreStyle {
    return {
      opacity: this.readCssNumber('--ogm-fill-opacity', 0.8),
      fillColor: this.themedColor('--ogm-fill-color', '--wa-color-blue-50', '--wa-color-blue-80'),
      fillHighlightColor: this.themedColor('--ogm-fill-highlight-color', '--wa-color-cyan-60', '--wa-color-cyan-80'),
      fillSelectedColor: this.themedColor('--ogm-fill-selected-color', '--wa-color-green-50', '--wa-color-green-80'),
      fillInvalidColor: this.themedColor('--ogm-fill-invalid-color', '--wa-color-red-50', '--wa-color-red-60'),
      strokeColor: this.themedColor('--ogm-stroke-color', '--wa-color-blue-80', '--wa-color-blue-50'),
      strokeHighlightColor: this.themedColor('--ogm-stroke-highlight-color', '--wa-color-cyan-80', '--wa-color-cyan-60'),
      strokeSelectedColor: this.themedColor('--ogm-stroke-selected-color', '--wa-color-green-80', '--wa-color-green-50'),
      strokeInvalidColor: this.themedColor('--ogm-stroke-invalid-color', '--wa-color-red-80', '--wa-color-red-30'),
      textColor: this.themedColor('--ogm-text-color', '--wa-color-gray-95', '--wa-color-gray-05'),
      textHaloColor: this.themedColor('--ogm-text-halo-color', '--wa-color-gray-05', '--wa-color-gray-95'),
      textFont: this.readCssProperty('--ogm-font-family') || defaultGlyphFont,
      textSize: this.readCssNumber('--ogm-text-size', 14),
      fillHighlightOpacity: this.readCssNumber('--ogm-fill-highlight-opacity', 0.8),
      boundsOpacity: this.readCssNumber('--ogm-bounds-opacity', 0.5),
    };
  }

  // Get the appropriate basemap style URL based on dark mode
  getBaseMapStyle(): string {
    return this.darkMode() ? darkBasemapStyle : lightBasemapStyle;
  }

  // An embedding app's override if it set one, otherwise our own token for the current mode. One
  // override covers both modes: an app that names a color has said it wants that color, and
  // second-guessing it in dark mode would be picking a color it never asked for.
  themedColor(override: string, darkColor: string, lightColor: string): string {
    return this.readCssProperty(override) || this.dualCssColors(darkColor, lightColor);
  }

  // If dark mode, use the first CSS color, otherwise use the second CSS color
  dualCssColors(darkColor: string, lightColor: string): string {
    return this.darkMode() ? this.readCssProperty(darkColor) : this.readCssProperty(lightColor);
  }

  // Atmosphere style for globe
  getSkyStyle(): SkySpecification {
    return {
      'sky-color': '#199EF3',
      'sky-horizon-blend': 0.5,
      'horizon-color': '#ffffff',
      'horizon-fog-blend': 0.5,
      'fog-color': '#0000ff',
      'fog-ground-blend': 0.5,
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 10, 1, 12, 0],
    };
  }
}
