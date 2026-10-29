import type { SkySpecification, StyleSpecification } from 'maplibre-gl';

import { atLightness, contrastColor, shiftLightness } from './color';
import Theme from './theme';

export type MapLibreStyle = {
  opacity: number;
  dataColor: string;
  highlightColor: string;
  selectedColor: string;
  invalidColor: string;
  markerColor: string;
  markerHighlightColor: string;
  strokeColor: string;
  strokeHighlightColor: string;
  strokeSelectedColor: string;
  strokeInvalidColor: string;
  textColor: string;
  textHaloColor: string;
  textFont: string;
  textSize: number;
  markerFont: string;
  highlightOpacity: number;
  boundsOpacity: number;
  overviewPadding: number;
};

export const darkBasemapStyle = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
export const lightBasemapStyle = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

export const defaultBeforeId = 'watername_ocean';

const defaultMarkerFont = 'system-ui, sans-serif';

// MapLibre text-font names a glyph-server font, which cannot use a CSS font stack.
const defaultGlyphFont = 'Noto Sans Regular';

const strokeLightnessShift = 0.26;

const markerLightness = 0.7;

const defaultOverviewPadding = 64;

const dataColorDark = '#0071ec';
const dataColorLight = '#9fceff';
const highlightColorDark = '#f36d00';
const highlightColorLight = '#f36d00';
const selectedColorDark = '#e9a010';
const selectedColorLight = '#fde588';
const invalidColorDark = '#e02c2b';
const invalidColorLight = '#f56667';
const textColorDark = '#f1f2f3';
const textColorLight = '#101219';

const emptyBasemapColorDark = '#0e1013';
const emptyBasemapColorLight = '#f8f8f8';

export default class MapLibreTheme extends Theme {
  darkBasemap?: string;
  lightBasemap?: string;

  constructor(element: Element, theme?: 'light' | 'dark', basemaps: { darkBasemap?: string; lightBasemap?: string } = {}) {
    super(element, theme);
    this.darkBasemap = basemaps.darkBasemap;
    this.lightBasemap = basemaps.lightBasemap;
  }

  getStyle(): MapLibreStyle {
    const dataColor = this.themedColor('--ogm-data-color', dataColorDark, dataColorLight);
    const highlightColor = this.themedColor('--ogm-highlight-color', highlightColorDark, highlightColorLight);
    const selectedColor = this.themedColor('--ogm-selected-color', selectedColorDark, selectedColorLight);
    const invalidColor = this.themedColor('--ogm-invalid-color', invalidColorDark, invalidColorLight);
    const textColor = this.themedColor('--ogm-text-color', textColorDark, textColorLight);

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

  getOverviewPadding(): number {
    return this.readCssNumber('--ogm-overview-padding', defaultOverviewPadding);
  }

  getBaseMapStyle(): string {
    const darkMode = this.darkMode();
    return (darkMode ? this.darkBasemap : this.lightBasemap) ?? (darkMode ? darkBasemapStyle : lightBasemapStyle);
  }

  getFallbackBaseMapStyle(): StyleSpecification {
    return {
      version: 8,
      sources: {},
      layers: [
        {
          id: 'ogm-empty-basemap',
          type: 'background',
          paint: { 'background-color': this.dualColors(emptyBasemapColorDark, emptyBasemapColorLight) },
        },
      ],
    };
  }

  strokeColor(override: string, dataColor: string): string {
    return this.readCssProperty(override) || shiftLightness(dataColor, this.darkMode() ? strokeLightnessShift : -strokeLightnessShift);
  }

  markerColor(override: string, color: string): string {
    return this.readCssProperty(override) || atLightness(color, markerLightness);
  }

  haloColor(textColor: string): string {
    return this.readCssProperty('--ogm-text-halo-color') || contrastColor(textColor) || this.dualColors(textColorLight, textColorDark);
  }

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
