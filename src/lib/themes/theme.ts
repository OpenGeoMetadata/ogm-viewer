const defaultPadding = 32;

export default class Theme {
  protected element: Element;

  theme?: 'light' | 'dark';

  constructor(element: Element, theme?: 'light' | 'dark') {
    this.element = element;
    this.theme = theme;
  }

  getPadding(): number {
    return this.readCssNumber('--ogm-padding', defaultPadding);
  }

  // Prefer the explicit theme because the shadow-root stylesheet may not be ready yet.
  protected darkMode(): boolean {
    if (this.theme) return this.theme === 'dark';
    return this.readCssProperty('color-scheme') === 'dark';
  }

  // Safari can expose inline CSS comments in computed palette values; MapLibre rejects those colors.
  protected readCssProperty = (property: string): string => {
    return window
      .getComputedStyle(this.element)
      .getPropertyValue(property)
      .replace(/\/\*.*?\*\//g, '')
      .trim();
  };

  dualColors(darkColor: string, lightColor: string): string {
    return this.darkMode() ? darkColor : lightColor;
  }

  themedColor(override: string, darkColor: string, lightColor: string): string {
    return this.readCssProperty(override) || this.dualColors(darkColor, lightColor);
  }

  protected readCssNumber = (property: string, fallback: number): number => {
    const value = parseFloat(this.readCssProperty(property));
    return Number.isFinite(value) ? value : fallback;
  };
}
