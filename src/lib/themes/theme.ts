// Extracts style values from the DOM/CSS for use in previewers
export default abstract class Theme {
  protected element: Element;

  // Store a reference to DOM element so we can use it to inspect styles
  constructor(element: Element) {
    this.element = element;
  }

  // Returns style properties for this theme
  abstract getStyle(): Record<string, any>;

  // Check if we're in dark mode
  protected darkMode(): boolean {
    return this.readCssProperty('color-scheme') === 'dark';
  }

  // Web Awesome's palette tokens are documented inline (e.g. "#0a3a1d /* oklch(...) */").
  // Browsers are supposed to strip CSS comments before exposing a custom property's computed
  // value, but Safari has a bug where the comment survives, which MapLibre then rejects as an
  // invalid color. Strip it defensively here so we don't depend on browser-specific behavior.
  protected readCssProperty = (property: string): string => {
    return window
      .getComputedStyle(this.element)
      .getPropertyValue(property)
      .replace(/\/\*.*?\*\//g, '')
      .trim();
  };
}
