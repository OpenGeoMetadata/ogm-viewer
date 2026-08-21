import type { SkySpecification } from 'maplibre-gl';

import { atLightness, contrastColor, shiftLightness } from './color';
import Theme from './theme';

export type MapLibreStyle = {
  // Generic properties used for all data
  opacity: number;
  // CSS colors used for the data itself: polygon fills, lines, and circles
  dataColor: string;
  highlightColor: string;
  selectedColor: string;
  invalidColor: string;
  // CSS colors for the disc a result's number is drawn on, and for the disc of a result being
  // highlighted - by a pointer over its number, or by something outside pointing at it
  markerColor: string;
  markerHighlightColor: string;
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
  // A CSS font stack, for text this library draws itself rather than asking MapLibre to draw - see
  // textFont, which names something else entirely
  markerFont: string;
  // Opacity for highlighted polygons/circles
  highlightOpacity: number;
  // Initial opacity for a preview that says where a record is rather than showing its data: a
  // bounding box, or an index map's sheet boundaries. Below `opacity`, because neither is what a
  // reader came to look at, and both would otherwise cover the basemap they're being placed against.
  boundsOpacity: number;
  // Padding used for overviews, where we want to see more around the previewed data
  overviewPadding: number;
};

// URLs to MapLibre style documents for basemaps
export const darkBasemapStyle = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
export const lightBasemapStyle = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

// What a result's number is drawn in when neither an app nor the palette has said. A CSS font stack,
// unlike the glyph name below: the numbers are drawn into an image of our own rather than handed to
// MapLibre, which is also the only reason they can be bold at all - see markerImage. Web Awesome's own
// body font comes first, so the numbers match whatever the rest of the page is set in.
const defaultMarkerFont = 'system-ui, sans-serif';

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

// How deep the disc a result's number is drawn on sits, in OKLab lightness. A target rather than a
// step, unlike the outline above: a number has to be readable on its disc in both modes, and the two
// tokens behind one color start at opposite ends of the scale, so the same step from each would land
// one of them either side of the point where white stops being the more readable ink. Every color in
// the palette clears that point at this value, and so does anything an app is likely to name, which
// is what lets the numeral be white by construction rather than by luck.
const markerLightness = 0.45;

// Larger padding used for overviews (search results, locators)
const defaultOverviewPadding = 64;

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
      markerColor: this.markerColor('--ogm-marker-color', dataColor),
      markerHighlightColor: this.markerColor('--ogm-marker-highlight-color', highlightColor),
      strokeColor: this.strokeColor('--ogm-stroke-color', dataColor),
      strokeHighlightColor: this.strokeColor('--ogm-stroke-highlight-color', highlightColor),
      strokeSelectedColor: this.strokeColor('--ogm-stroke-selected-color', selectedColor),
      strokeInvalidColor: this.strokeColor('--ogm-stroke-invalid-color', invalidColor),
      textColor,
      textHaloColor: this.haloColor(textColor),
      textFont: this.readCssProperty('--ogm-font-family') || defaultGlyphFont,
      textSize: this.readCssNumber('--ogm-text-size', 14),
      markerFont: this.readCssProperty('--ogm-marker-font') || this.readCssProperty('--wa-font-family-body') || defaultMarkerFont,
      highlightOpacity: this.readCssNumber('--ogm-highlight-opacity', 0.8),
      boundsOpacity: this.readCssNumber('--ogm-bounds-opacity', 0.6),
      overviewPadding: this.getOverviewPadding(),
    };
  }

  // Padding used for the overviews
  getOverviewPadding(): number {
    return this.readCssNumber('--ogm-overview-padding', defaultOverviewPadding);
  }

  // Get the appropriate basemap style URL based on dark mode
  getBaseMapStyle(): string {
    return this.darkMode() ? darkBasemapStyle : lightBasemapStyle;
  }

  // The outline for a color, unless an app named one. Derived rather than themed, because the
  // outline isn't a second decision - it's the same color moved off the background, and an app that
  // had to name both could only name one pair for both modes. This one follows the mode.
  strokeColor(override: string, dataColor: string): string {
    return this.readCssProperty(override) || shiftLightness(dataColor, this.darkMode() ? strokeLightnessShift : -strokeLightnessShift);
  }

  // The disc a result's number is read against, unless an app named one. Derived for the reason the
  // outline above is - an app that named --ogm-data-color has named this too, and one that had to name
  // both could only name a pair for a single mode - but derived to a lightness rather than by a step,
  // because this one has to carry a numeral. See markerLightness. Whatever comes out, the numeral is
  // drawn in whichever of black and white can be read on it, so an app that does name a color of its
  // own gets ink that follows it.
  markerColor(override: string, color: string): string {
    return this.readCssProperty(override) || atLightness(color, markerLightness);
  }

  // What a label is read against, derived the same way, but to the opposite end of the scale rather
  // than a step along it - the halo's whole job is to hold the text apart from whatever basemap is
  // under it. No mode to consult: the text color already answered that, and the halo answers to the
  // text. Falls back to the token pair only if the text color is something we can't read, where a
  // halo derived from it would come out the same color as the text and swallow the label.
  haloColor(textColor: string): string {
    return this.readCssProperty('--ogm-text-halo-color') || contrastColor(textColor) || this.dualCssColors('--wa-color-gray-05', '--wa-color-gray-95');
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
