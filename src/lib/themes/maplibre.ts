import type { SkySpecification } from 'maplibre-gl';

import { contrastColor, shiftLightness } from './color';
import Theme from './theme';

export type MapLibreStyle = {
  // Generic properties used for all data
  opacity: number;
  // CSS colors used for the data itself: polygon fills, lines, and circles
  dataColor: string;
  highlightColor: string;
  selectedColor: string;
  invalidColor: string;
  // CSS colors used for polygon outlines & circle borders
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
  highlightOpacity: number;
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

// How far an outline sits from the color it outlines, in OKLab lightness. Away from the background:
// darker on a light basemap, lighter on a dark one. Web Awesome's own palette pairs - the ones this
// used to name a token apiece for - sit about this far apart, so a theme nobody has touched looks
// the way it did, and one that names a color gets an outline that follows it into either mode.
const strokeLightnessShift = 0.26;

// What Web Awesome's default palette holds for each token this theme names. Read only when the
// palette itself can't be read - a component used on its own whose copy of the theme failed to
// fetch, or one nothing established a scope for - where every `--wa-color-*` comes out as the empty
// string. MapLibre rejects a layer whose paint color is empty rather than falling back to anything,
// so a preview styled from an unreadable palette isn't drawn faintly, it isn't drawn at all.
//
// A floor rather than a second theme: these are the colors those tokens hold, so a palette that
// loads changes nothing, and one that doesn't still gets the map drawn.
const paletteDefaults = {
  '--wa-color-blue-50': '#0071ec',
  '--wa-color-blue-80': '#9fceff',
  '--wa-color-cyan-60': '#00a3c0',
  '--wa-color-cyan-80': '#7fd6ec',
  '--wa-color-green-50': '#00883c',
  '--wa-color-green-80': '#93da98',
  '--wa-color-red-50': '#dc3146',
  '--wa-color-red-60': '#f3676c',
  '--wa-color-gray-05': '#101219',
  '--wa-color-gray-95': '#f1f2f3',
} as const;

// A palette token this theme is allowed to name. One without a color above isn't one, so naming a
// token nothing can fall back to is a type error here rather than an empty color at runtime.
type PaletteToken = keyof typeof paletteDefaults;

// Style properties common to all MapLibre-based previewers
export default class MapLibreTheme extends Theme {
  /**
   * How previewed data is drawn. Every value here can be overridden by setting the matching
   * `--ogm-*` custom property on the component or anything above it - custom properties inherit
   * through shadow boundaries, so setting them on the embedding page reaches in:
   *
   *   ogm-viewer { --ogm-data-color: #8f1414; }
   *
   * Left alone, each falls back to a Web Awesome token, picked for the current mode. Those are the
   * library's own palette and move with it; the `--ogm-*` names are the contract, and are the only
   * ones an embedding app should be naming.
   *
   * An app names the color of the data itself and the outline comes from it, so one declaration
   * restyles a state. `--ogm-stroke-*` is still there for anyone who wants a particular outline.
   *
   * `--ogm-font-family` is the one exception: it names a MapLibre glyph font (e.g. "Noto Sans
   * Regular"), not a CSS font stack, so it can't fall back to `--wa-font-family-body` - that's a
   * CSS stack like "ui-sans-serif, system-ui, sans-serif", and MapLibre would request it verbatim
   * from the style's glyphs endpoint and get a CORS failure. An app overriding it must give a
   * glyph name the active basemap style actually serves.
   */
  getStyle(): MapLibreStyle {
    const dataColor = this.themedColor('--ogm-data-color', '--wa-color-blue-50', '--wa-color-blue-80');
    const highlightColor = this.themedColor('--ogm-highlight-color', '--wa-color-cyan-60', '--wa-color-cyan-80');
    const selectedColor = this.themedColor('--ogm-selected-color', '--wa-color-green-50', '--wa-color-green-80');
    const invalidColor = this.themedColor('--ogm-invalid-color', '--wa-color-red-50', '--wa-color-red-60');
    const textColor = this.themedColor('--ogm-text-color', '--wa-color-gray-95', '--wa-color-gray-05');

    return {
      opacity: this.readCssNumber('--ogm-data-opacity', 0.8),
      dataColor,
      highlightColor,
      selectedColor,
      invalidColor,
      strokeColor: this.strokeColor('--ogm-stroke-color', dataColor),
      strokeHighlightColor: this.strokeColor('--ogm-stroke-highlight-color', highlightColor),
      strokeSelectedColor: this.strokeColor('--ogm-stroke-selected-color', selectedColor),
      strokeInvalidColor: this.strokeColor('--ogm-stroke-invalid-color', invalidColor),
      textColor,
      textHaloColor: this.haloColor(textColor),
      textFont: this.readCssProperty('--ogm-font-family') || defaultGlyphFont,
      textSize: this.readCssNumber('--ogm-text-size', 14),
      highlightOpacity: this.readCssNumber('--ogm-highlight-opacity', 0.8),
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
  themedColor(override: string, darkColor: PaletteToken, lightColor: PaletteToken): string {
    return this.readCssProperty(override) || this.dualCssColors(darkColor, lightColor);
  }

  // The outline for a color, unless an app named one. Derived rather than themed, because the
  // outline isn't a second decision - it's the same color moved off the background, and an app that
  // had to name both could only name one pair for both modes. This one follows the mode.
  strokeColor(override: string, dataColor: string): string {
    return this.readCssProperty(override) || shiftLightness(dataColor, this.darkMode() ? strokeLightnessShift : -strokeLightnessShift);
  }

  // What a label is read against, derived the same way, but to the opposite end of the scale rather
  // than a step along it - the halo's whole job is to hold the text apart from whatever basemap is
  // under it. No mode to consult: the text color already answered that, and the halo answers to the
  // text. Falls back to the token pair only if the text color is something we can't read, where a
  // halo derived from it would come out the same color as the text and swallow the label.
  haloColor(textColor: string): string {
    return this.readCssProperty('--ogm-text-halo-color') || contrastColor(textColor) || this.dualCssColors('--wa-color-gray-05', '--wa-color-gray-95');
  }

  // If dark mode, use the first CSS color, otherwise use the second CSS color - and if the palette
  // both come from can't be read at all, the color that token holds in it; see paletteDefaults.
  dualCssColors(darkColor: PaletteToken, lightColor: PaletteToken): string {
    const token = this.darkMode() ? darkColor : lightColor;
    return this.readCssProperty(token) || paletteDefaults[token];
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
