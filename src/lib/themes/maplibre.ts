import type { SkySpecification } from 'maplibre-gl';

import Theme from './theme';

export type MapLibreStyle = {
  // Generic properties used for all data
  padding: string;
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
  textFont: string;
  textSize: number;
  // Opacity values (decimal between 0 and 1)
  fillOpacity: number;
  fillHighlightOpacity: number;
};

// URLs to MapLibre style documents for basemaps
export const darkBasemapStyle = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
export const lightBasemapStyle = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

// Style properties common to all MapLibre-based previewers
export default class MapLibreTheme extends Theme {
  getStyle(): MapLibreStyle {
    return {
      padding: this.readCssProperty('--wa-space-xl'),
      opacity: 0.8,
      fillColor: this.dualCssColors('--wa-color-blue-50', '--wa-color-blue-80'),
      fillHighlightColor: this.dualCssColors('--wa-color-cyan-60', '--wa-color-cyan-80'),
      fillSelectedColor: this.dualCssColors('--wa-color-green-50', '--wa-color-green-80'),
      fillInvalidColor: this.dualCssColors('--wa-color-yellow-50', '--wa-color-yellow-80'),
      strokeColor: this.dualCssColors('--wa-color-blue-80', '--wa-color-blue-50'),
      strokeHighlightColor: this.dualCssColors('--wa-color-cyan-80', '--wa-color-cyan-60'),
      strokeSelectedColor: this.dualCssColors('--wa-color-green-80', '--wa-color-green-50'),
      strokeInvalidColor: this.dualCssColors('--wa-color-yellow-80', '--wa-color-yellow-50'),
      textColor: this.readCssProperty('--wa-color-text-normal'),
      textFont: this.readCssProperty('--wa-font-family-body'),
      textSize: 12,
      fillOpacity: 0.5,
      fillHighlightOpacity: 0.8,
    };
  }

  // Get the appropriate basemap style URL based on dark mode
  getBaseMapStyle(): string {
    return this.darkMode() ? darkBasemapStyle : lightBasemapStyle;
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
