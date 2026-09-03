/**
 * What initialTheme() is for, checked against the build that made it necessary: the lazy one, out of
 * www/, loaded by src/index.html and by the GitHub Pages preview site. A @Prop's default compiles to
 * a class field initializer, which runs before the constructor body that registers the host ref -
 * and this is the build where @Element() is a getter over that ref, so a default reading it reads
 * undefined. Every component below opened by doing exactly that, and every one of them failed to
 * construct: no `hydrated` class, an empty shadow root, nothing on the page at all.
 *
 * So these tests ask each of them for the three things that have to hold however the theme is arrived
 * at - that it constructs, that the theme it opens in is the one its own tag named, and that the
 * stylesheet drawing that theme is in its shadow root - by driving the built bundle through its own
 * loader. Nothing else in the suite can: the plugin that compiles a
 * component for a test emits the custom-elements form, where the instance *is* the element and the
 * same field reads fine. See src/lib/init.test.ts for initialTheme() on its own.
 *
 * Reads the built output, so `npm run build` has to have run first.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';

import { adoptWebAwesomeTheme } from './init';

// Imported through a variable to keep tsc out of it: this is built JavaScript with no declarations
// beside it, and the loader defines every component in the library as a side effect of being run.
const LOADER = '../../www/build/ogm-viewer.esm.js';

// Every component that resolves its own opening theme, which is every one that can be used on its
// own plus the ones <ogm-viewer> renders - see initialTheme's callers.
const TAGS = ['ogm-viewer', 'ogm-locator', 'ogm-overview', 'ogm-alerts', 'ogm-preview', 'ogm-previews', 'ogm-map', 'ogm-image'];

// Stands in for the browser's own preference, the way init.test.ts does it, so that each test can
// name a preference that disagrees with the answer it expects.
const preferDark = (dark: boolean) => vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: dark }));

// The wa-light/wa-dark classes a host was given over its lifetime, in the order it got them. Both
// would be present if a component rendered once in one theme and then corrected itself, which is the
// flash initialTheme() exists to prevent and which asserting on the settled class alone would miss.
const themesNamed = (classes: string[]): string[] => [...new Set(classes.flatMap(className => className.split(' ')).filter(name => name === 'wa-light' || name === 'wa-dark'))];

// One stylesheet's rules as text, which is how a sheet a component adopted can be compared with one
// this file built: the component came out of the bundle under test, so its copy of the library is a
// different object than this file's own import - built from the same string.
const cssOf = (sheet: CSSStyleSheet): string =>
  Array.from(sheet.cssRules)
    .map(rule => rule.cssText)
    .join('\n');

// The Web Awesome theme as a component that took it should carry it
const webAwesomeTheme = (): string => {
  const root = document.createElement('div').attachShadow({ mode: 'open' });
  adoptWebAwesomeTheme(root.host);
  return cssOf(root.adoptedStyleSheets[0]);
};

// Mount a component the way a page does - attribute first, then into the document - and wait for the
// class the runtime adds once it has rendered. A component that never constructs never gets it, so
// the wait is bounded well short of the test timeout to fail as an assertion rather than a timeout.
const mount = async (tag: string, theme?: 'light' | 'dark') => {
  const el = document.createElement(tag) as HTMLElement & { theme?: 'light' | 'dark' };
  const classes: string[] = [];
  new MutationObserver(records => records.forEach(record => classes.push((record.target as Element).className))).observe(el, {
    attributes: true,
    attributeFilter: ['class'],
  });
  if (theme) el.setAttribute('theme', theme);

  document.body.append(el);
  for (let i = 0; i < 120 && !el.classList.contains('hydrated'); i += 1) await new Promise(resolve => setTimeout(resolve, 25));
  return { el, classes };
};

beforeAll(async () => {
  await import(LOADER);

  // Warm the bundle: the loader fetches the entry chunk the first time a component of ours is asked
  // for, and that one component would otherwise be waiting on a download the rest of them aren't.
  await mount('ogm-alerts');
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe.each(TAGS)('<%s> in the lazy build', tag => {
  it('constructs, and opens in the theme its own tag names', async () => {
    preferDark(false);
    const { el, classes } = await mount(tag, 'dark');

    expect(el.className).toContain('hydrated');
    expect(el.theme).toEqual('dark');
    expect(themesNamed(classes)).not.toContain('wa-light');
  });

  it('falls back to the browser preference when its tag names no theme', async () => {
    preferDark(true);
    const { el, classes } = await mount(tag);

    expect(el.className).toContain('hydrated');
    expect(el.theme).toEqual('dark');
    expect(themesNamed(classes)).not.toContain('wa-light');
  });

  // The other half of opening in the right theme: having the stylesheet that draws it. Each of these
  // adopts it in componentWillLoad, which asks the host element for its shadow root - and this is the
  // build where the element is a getter over a host ref rather than the instance itself, so whether
  // there is a root to adopt into that early is a question only this build can answer.
  it('renders with the Web Awesome theme in its own shadow root', async () => {
    const { el } = await mount(tag);

    expect((el.shadowRoot as ShadowRoot).adoptedStyleSheets.map(cssOf)).toContain(webAwesomeTheme());
  });
});
