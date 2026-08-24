import { getBasePath, registerIconLibrary, setBasePath } from '@awesome.me/webawesome';

// Where this library's own files live. Anchored to this module's URL rather than to Stencil's asset
// path: the custom-elements build starts that path empty, so it would resolve against the embedding
// page rather than against us, and every icon and the Web Awesome theme would 404 on any host that
// doesn't happen to serve our assets at its own root. Stencil's setAssetPath() is not usable from
// inside the library either - the compiler rewires getAssetPath() into component bundles but leaves
// setAssetPath as a bare global reference, so calling it here throws at load. Reading import.meta.url
// asks the only question that actually matters, and holds whether we're loaded from a CDN, from a
// host's own assets, or from a dev server.
setBasePath(new URL('.', import.meta.url).href);

// Serve icons from our self-hosted bootstrap-icons subset instead of the default Font Awesome library
registerIconLibrary('default', {
  resolver: name => getBasePath(`assets/icons/${name}.svg`),
});

// The Web Awesome theme, which components link inside their own shadow root rather than at the top
// of the page: loading it into the document would restyle the host app around us.
export const webAwesomeStylesheet = (): string => getBasePath('assets/webawesome/styles/themes/default.css');

// Web Awesome activates its palette and semantic color variants on `:root` by default (with `.wa-*`
// classes only needed to override the defaults). `:root` never matches inside a shadow tree, so we
// opt into each default explicitly to reproduce what a document-level load would give us: the
// default palette plus the default hue for every color variant.
const WA_PALETTE = 'wa-palette-default wa-brand-blue wa-neutral-gray wa-success-green wa-warning-yellow wa-danger-red';

/**
 * The classes that turn a shadow root into a Web Awesome scope, paired with the stylesheet link
 * above. Every component that can be used on its own applies both, rather than counting on an
 * <ogm-viewer> above it: custom properties inherit through shadow boundaries, so the outermost one
 * in use is the one that has to establish them, and which component that is depends on the embed.
 *
 * They belong on an element *inside* the shadow root - a container the component already wraps its
 * content in - and not on the <Host> alone. Web Awesome declares its palette with plain class
 * selectors, and a plain class selector in a shadow root's own stylesheet never matches the host of
 * that root, so a scope class sitting there alone establishes nothing for the tree below it: every
 * color reads as the empty string. Worth applying to the Host as well, though, because that class is
 * matched by the *parent's* stylesheet one shadow root out - which is what gives a nested
 * component's own :host rules their colors.
 *
 * Applying them more than once down a single tree is harmless - the values are identical, and the
 * browser fetches the stylesheet once - which is why nobody tries to detect whether an ancestor got
 * there first. At first paint there is no reliable answer to that question anyway.
 */
export const waScope = (theme?: 'light' | 'dark'): string => `${WA_PALETTE} wa-${theme ?? 'light'}`;

// Which theme to draw in when nobody said. Only consulted by a component used on its own;
// <ogm-viewer> passes its own resolved theme down to everything it renders.
export const themePreference = (): 'light' | 'dark' => (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

/**
 * What to open a component's `theme` prop with, before anyone has had a chance to set it: the
 * attribute already on the tag, or themePreference() when there isn't one.
 *
 * The element is optional because of *when* a @Prop default is evaluated: it compiles to a class
 * field initializer, and those run ahead of the constructor's own body. That is early enough to
 * matter in the lazy build, where @Element() becomes a getter over the host ref and the ref is only
 * registered by the constructor's first statement - so a field reading it gets undefined, and
 * anything it calls has to survive that. (Under dist-custom-elements the instance *is* the element,
 * which is why the same field reads fine there, and why nothing but the lazy build ever noticed.)
 *
 * Falling back to the preference there costs no accuracy: the lazy runtime has already recorded the
 * `theme` attribute against the prop by the time it builds the instance - it does that as the element
 * upgrades - and it keeps that value over one a field initializer writes during construction. So a
 * tag that named a theme still renders in it, first frame included, which is the whole point of
 * resolving a theme this early.
 */
export const initialTheme = (el?: Element): 'light' | 'dark' => {
  const attr = el?.getAttribute('theme');
  return attr === 'light' || attr === 'dark' ? attr : themePreference();
};
