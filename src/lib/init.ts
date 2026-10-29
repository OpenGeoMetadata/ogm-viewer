import { registerIconLibrary, setBasePath } from '@awesome.me/webawesome';
import { iconSvgs, webAwesomeThemeCss } from './assets.generated';

setBasePath(new URL('.', import.meta.url).href);

// Data URLs keep icons inside the bundle; pages with CSP must allow data: in connect-src.
registerIconLibrary('default', {
  resolver: name => (Object.hasOwn(iconSvgs, name) ? `data:image/svg+xml,${encodeURIComponent(iconSvgs[name])}` : ''),
});

// Constructed stylesheets belong to one document and cannot be adopted across iframe documents.
const themeSheets = new WeakMap<Document, CSSStyleSheet>();

// Set inherited tooltip tokens on the scope so they also reach nested shadow roots.
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

export const adoptWebAwesomeTheme = (host: Element): void => {
  const root = host.shadowRoot;
  if (!root) return;

  const sheet = themeSheet(root.ownerDocument);
  if (root.adoptedStyleSheets.includes(sheet)) return;
  root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
};

// Web Awesome's :root defaults do not match inside a shadow tree, so opt into them explicitly.
const WA_PALETTE = 'wa-palette-default wa-brand-blue wa-neutral-gray wa-success-green wa-warning-yellow wa-danger-red';

// Apply the scope inside the shadow root; its own stylesheet cannot match classes on the host.
export const waScope = (theme?: 'light' | 'dark'): string => `${WA_PALETTE} wa-${theme ?? 'light'}`;

export const themePreference = (): 'light' | 'dark' => (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

// Lazy-build field initializers run before the host reference is registered, so el can be undefined.
export const initialTheme = (el?: Element): 'light' | 'dark' => {
  const attr = el?.getAttribute('theme');
  return attr === 'light' || attr === 'dark' ? attr : themePreference();
};
