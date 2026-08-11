// How much room to leave around a preview when nothing names an amount, in CSS pixels. A number
// rather than a Web Awesome token, unlike the colors: `--wa-space-xl` computes to `calc(1 * 2rem)`,
// and what reads this wants a pixel count to hand a camera, not a length to resolve. 32 is what
// that token comes out to at the default space scale.
const defaultPadding = 32;

// Extracts style values from the DOM/CSS for use in previewers. Usable on its own, for a renderer
// that wants nothing beyond what every renderer reads: <ogm-image> only needs the padding, and
// OpenSeadragon has no style document of its own for a subclass to describe.
export default class Theme {
  protected element: Element;

  // Which way the component drawing this was told to render, if it was told. Mutable because a
  // component's theme can change under a preview that is already on screen.
  theme?: 'light' | 'dark';

  // Store a reference to DOM element so we can use it to inspect styles
  constructor(element: Element, theme?: 'light' | 'dark') {
    this.element = element;
    this.theme = theme;
  }

  // How much room to leave between what a preview draws and the edge of the view, in CSS pixels.
  // Read by whatever points the view - a map fitting a record's bounds, an image viewer fitting a
  // scan - so that a preview's own edges can be seen as edges rather than running off the view.
  getPadding(): number {
    return this.readCssNumber('--ogm-padding', defaultPadding);
  }

  // Check if we're in dark mode. The component's own answer wins: `color-scheme` comes from the Web
  // Awesome stylesheet, which is linked into a shadow root and so may not have loaded by the time a
  // map is first built - and a component used on its own may have no Web Awesome scope above it at all.
  protected darkMode(): boolean {
    if (this.theme) return this.theme === 'dark';
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

  // A custom property read as a number, for the styles that aren't colors. A property nobody set
  // reads as the empty string and parses as NaN, which is the signal to keep the default.
  protected readCssNumber = (property: string, fallback: number): number => {
    const value = parseFloat(this.readCssProperty(property));
    return Number.isFinite(value) ? value : fallback;
  };
}
