import { registerIconLibrary, setBasePath } from '@awesome.me/webawesome';
import { iconSvgs, webAwesomeThemeCss } from './assets.generated';

// Where Web Awesome resolves whatever it fetches for itself against - its autoloader, a kit icon.
// Nothing this library ships needs it any more: the icons and the theme below are compiled into the
// bundle, for the reason scripts/inline-assets.mjs gives. Still anchored to this module's URL rather
// than left alone, because what Web Awesome falls back to on its own is the embedding page's root,
// and a request for our files answered by the host app's server is worse than one that 404s.
// Stencil's own asset path is not usable from inside the library either - the compiler rewires
// getAssetPath() into component bundles but leaves setAssetPath as a bare global reference, so
// calling it here throws at load - and reading import.meta.url holds however we were loaded.
setBasePath(new URL('.', import.meta.url).href);

// Serve icons from our own bootstrap-icons subset instead of the default Font Awesome library. As
// data URLs, because a URL is the only form of "here is an icon" <wa-icon> takes - it fetches
// whatever the resolver hands back - and a data URL is the one form of that which needs no file
// shipped beside us and no request off the page at all. A name we don't have resolves to nothing,
// which draws nothing, rather than to a URL that 404s.
//
// The one thing this costs, and it is in the readme: because <wa-icon> reaches these through fetch,
// a page with a Content-Security-Policy has to allow `data:` in connect-src or every icon comes out
// blank. Nothing else here does - the theme below is adopted rather than fetched or inlined into an
// element, and no CSP directive covers a constructed stylesheet.
registerIconLibrary('default', {
  resolver: name => (Object.hasOwn(iconSvgs, name) ? `data:image/svg+xml,${encodeURIComponent(iconSvgs[name])}` : ''),
});

// One theme stylesheet for the whole library, per document, built the first time anyone asks for it.
// Constructed from the shadow root's own document because a stylesheet belongs to the document that
// made it: adopting one into a root in another document - our components inside an iframe, say -
// throws instead of styling anything.
const themeSheets = new WeakMap<Document, CSSStyleSheet>();

/**
 * Our own corrections to Web Awesome's defaults, adopted alongside its theme so that one definition
 * covers every component that shows one of these elements rather than each stylesheet repeating it.
 *
 * wa-tooltip inverts itself: its background is --wa-color-text-normal and its text is the surface,
 * so it comes out light on dark in dark mode and dark on light in light mode. That is a fair
 * convention for a tooltip on a page, but every tooltip here sits inside the viewer - over a map
 * popup, beside panels that all use the surface colors - where inverting reads as not having been
 * themed at all. Pointed at the raised surface instead. The border has to be named too: it defaults
 * to the background color, which would leave the tooltip edgeless once the two surfaces match.
 *
 * On the scope classes rather than on `wa-tooltip` itself, and that is the whole trick: a rule only
 * styles elements in the roots that adopt the sheet it came from, and the tooltips are in roots that
 * adopt nothing - <ogm-attributes>' and <ogm-menubar>'s. Custom properties do cross a shadow
 * boundary, so declaring them where waScope() puts its class hands them to every tooltip below it,
 * whichever root it lives in. Declared after Web Awesome's own block, which sets these same
 * properties on the same classes, so this one wins on order.
 */
const WEB_AWESOME_OVERRIDES = `
  .wa-light,
  .wa-dark {
    --wa-tooltip-background-color: var(--wa-color-surface-raised, var(--wa-color-surface-default));
    --wa-tooltip-border-color: var(--wa-color-surface-border);
    --wa-tooltip-content-color: var(--wa-color-text-normal);
  }
`;

const themeSheet = (doc: Document): CSSStyleSheet => {
  const built = themeSheets.get(doc);
  if (built) return built;

  const sheet = new (doc.defaultView ?? window).CSSStyleSheet();
  sheet.replaceSync(`${webAwesomeThemeCss}\n${WEB_AWESOME_OVERRIDES}`);
  themeSheets.set(doc, sheet);
  return sheet;
};

/**
 * Give a component's shadow root the Web Awesome theme. Called from componentWillLoad by every
 * component that applies waScope() below - see there for why that is more than just <ogm-viewer>.
 *
 * Adopted rather than linked, and adopted rather than loaded into the document: a <link> needs a URL,
 * a URL means a file shipped beside this module, and an app that bundles us never copies that file -
 * which is how bundled consumers ended up with an unstyled viewer. Loading it at the top of the page
 * instead would style the host app around us, which is not ours to do. So the text is compiled in
 * (see scripts/inline-assets.mjs) and handed straight to the one place it belongs.
 *
 * Worth having beyond the bundling it fixes: the sheet is parsed once however many components adopt
 * it, and there is no request to wait on, so a component's first frame is already themed rather than
 * flashing unstyled until a stylesheet arrives.
 *
 * Where this lands among the shadow root's other sheets doesn't matter. Stencil puts a component's
 * own styles in front of anything already adopted, but everything Web Awesome declares here sits
 * inside an `@layer` - bar a handful of `--wa-color-*-on*` tokens nothing of ours sets - and an
 * unlayered rule beats a layered one whatever the order.
 */
export const adoptWebAwesomeTheme = (host: Element): void => {
  const root = host.shadowRoot;
  if (!root) return;

  const sheet = themeSheet(root.ownerDocument);
  if (root.adoptedStyleSheets.includes(sheet)) return;
  root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
};

// Web Awesome activates its palette and semantic color variants on `:root` by default (with `.wa-*`
// classes only needed to override the defaults). `:root` never matches inside a shadow tree, so we
// opt into each default explicitly to reproduce what a document-level load would give us: the
// default palette plus the default hue for every color variant.
const WA_PALETTE = 'wa-palette-default wa-brand-blue wa-neutral-gray wa-success-green wa-warning-yellow wa-danger-red';

/**
 * The classes that turn a shadow root into a Web Awesome scope, paired with the theme that
 * adoptWebAwesomeTheme() adopts into it. Every component that can be used on its own does both,
 * rather than counting on an <ogm-viewer> above it: custom properties inherit through shadow
 * boundaries, so the outermost one in use is the one that has to establish them, and which component
 * that is depends on the embed.
 *
 * They belong on an element *inside* the shadow root - a container the component already wraps its
 * content in - and not on the <Host> alone. Web Awesome declares its palette with plain class
 * selectors, and a plain class selector in a shadow root's own stylesheet never matches the host of
 * that root, so a scope class sitting there alone establishes nothing for the tree below it: every
 * color reads as the empty string. Worth applying to the Host as well, though, because that class is
 * matched by the *parent's* stylesheet one shadow root out - which is what gives a nested
 * component's own :host rules their colors.
 *
 * Applying them more than once down a single tree is harmless - the values are identical, and every
 * root adopts the same one stylesheet - which is why nobody tries to detect whether an ancestor got
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
