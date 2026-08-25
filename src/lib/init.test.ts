/** @vitest-environment happy-dom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { getIconLibrary } from '@awesome.me/webawesome/dist/components/icon/library.js';

import { iconSvgs, webAwesomeThemeCss } from './assets.generated';
import { adoptWebAwesomeTheme, initialTheme } from './init';

// Stands in for the browser's own preference, which themePreference() reads through
// window.matchMedia. Stubbed rather than left to happy-dom's own answer, so a test asking for dark
// gets dark regardless of what environment it happens to run under.
const preferDark = (dark: boolean) => vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: dark }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('initialTheme', () => {
  // The whole point: an element built from markup that already named a theme opens in it, rather
  // than in whatever the browser happens to prefer - see the comment on initialTheme for why the two
  // can disagree and why that disagreement is worth avoiding on a first render specifically.
  it('takes an attribute already on the element over the browser preference', () => {
    preferDark(true);
    const el = document.createElement('div');
    el.setAttribute('theme', 'light');

    expect(initialTheme(el)).toEqual('light');
  });

  it('takes a dark attribute over a light preference the same way', () => {
    preferDark(false);
    const el = document.createElement('div');
    el.setAttribute('theme', 'dark');

    expect(initialTheme(el)).toEqual('dark');
  });

  it('falls back to the browser preference when nothing was said', () => {
    preferDark(true);
    const el = document.createElement('div');

    expect(initialTheme(el)).toEqual('dark');
  });

  // The lazy build asks without an element: a @Prop's default runs as a class field initializer,
  // ahead of the constructor body that registers the host ref @Element() reads from, so there is
  // nothing to read an attribute off yet. Answering with the preference is right *and* enough there
  // - the runtime has the attribute either way, and puts it on the prop before anything renders -
  // where throwing takes the component's whole construction down with it. That is what it used to
  // do; src/lib/init.www.test.ts holds the other end of that story.
  it('falls back to the browser preference when there is no element yet', () => {
    preferDark(true);

    expect(initialTheme(undefined)).toEqual('dark');
  });

  // An attribute naming neither theme isn't a statement about either one - it's read the same as no
  // attribute at all, rather than, say, coerced to whichever name it happens to resemble.
  it('falls back to the browser preference for an attribute naming neither theme', () => {
    preferDark(true);
    const el = document.createElement('div');
    el.setAttribute('theme', 'auto');

    expect(initialTheme(el)).toEqual('dark');
  });
});

// A shadow root with nothing in it yet, which is what a component's own is when componentWillLoad
// runs - the point at which each of them takes the theme.
const shadowRoot = (): ShadowRoot => document.createElement('div').attachShadow({ mode: 'open' });

describe('adoptWebAwesomeTheme', () => {
  it('gives a shadow root the theme', () => {
    const root = shadowRoot();
    adoptWebAwesomeTheme(root.host);

    expect(root.adoptedStyleSheets).toHaveLength(1);
  });

  // The one stylesheet, not a copy each: what makes it cheap for eight components to do this, and
  // what a component test can look for to tell whether one of them did.
  it('adopts the same stylesheet into every root it is asked about', () => {
    const [one, two] = [shadowRoot(), shadowRoot()];
    adoptWebAwesomeTheme(one.host);
    adoptWebAwesomeTheme(two.host);

    expect(one.adoptedStyleSheets[0]).toBe(two.adoptedStyleSheets[0]);
  });

  // Asked twice because a component can be taken off the page and put back on it - see <ogm-map> and
  // Turbo - and because nothing checks whether an ancestor got there first.
  it('leaves what a root already adopted alone, and adopts nothing twice', () => {
    const root = shadowRoot();
    const own = new CSSStyleSheet();
    root.adoptedStyleSheets = [own];

    adoptWebAwesomeTheme(root.host);
    adoptWebAwesomeTheme(root.host);

    expect(root.adoptedStyleSheets).toHaveLength(2);
    expect(root.adoptedStyleSheets[0]).toBe(own);
  });

  // An element with no root of its own - one that hasn't upgraded yet, or a plain div - has nothing
  // to style and nothing to throw about either.
  it('does nothing for an element with no shadow root', () => {
    expect(() => adoptWebAwesomeTheme(document.createElement('div'))).not.toThrow();
  });
});

// What scripts/inline-assets.mjs wrote, checked here rather than in the script: a build that inlined
// the wrong thing leaves every component unstyled with nothing else failing.
describe('the inlined theme', () => {
  // A token declared four @imports down Web Awesome's own chain, so this holds only if the whole chain
  // was followed. Nothing resolves a relative URL once this is a string adopted into a shadow root.
  it('carries the stylesheets the theme imports, not just the theme', () => {
    expect(webAwesomeThemeCss).toContain('--wa-color-danger-on-normal');
    expect(webAwesomeThemeCss).not.toContain('@import');
  });
});

// The library <wa-icon name="..."> resolves through: our own subset of bootstrap-icons, handed over
// as data URLs so that an icon needs no file shipped beside us and no request off the page.
describe('the default icon library', () => {
  const iconUrl = async (name: string): Promise<string> => String(await getIconLibrary('default')!.resolver(name, 'default', 'regular', false));

  it('answers with the icon itself', async () => {
    const [type, encoded] = (await iconUrl('list')).split(',');

    expect(type).toEqual('data:image/svg+xml');
    expect(decodeURIComponent(encoded)).toEqual(iconSvgs['list']);
  });

  // The thing that actually has to hold: <wa-icon> fetches whatever the resolver hands back, and
  // reads the response as the SVG to draw.
  it('answers with a URL fetch resolves to the icon', async () => {
    const response = await fetch(await iconUrl('list'));

    expect(await response.text()).toEqual(iconSvgs['list']);
  });

  // A name we don't ship draws nothing, rather than sending the page after a file that isn't there.
  it('answers with nothing for a name it has no icon for', async () => {
    expect(await iconUrl('nonesuch')).toEqual('');
  });
});
