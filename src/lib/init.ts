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
 * Applying them more than once down a single tree is harmless - the values are identical, and the
 * browser fetches the stylesheet once - which is why nobody tries to detect whether an ancestor got
 * there first. At first paint there is no reliable answer to that question anyway.
 */
export const waScope = (theme?: 'light' | 'dark'): string => `${WA_PALETTE} wa-${theme ?? 'light'}`;

// Which theme to draw in when nobody said. Only consulted by a component used on its own;
// <ogm-viewer> passes its own resolved theme down to everything it renders.
export const themePreference = (): 'light' | 'dark' => (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
