/** @vitest-environment happy-dom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { getIconLibrary } from '@awesome.me/webawesome/dist/components/icon/library.js';

import { iconSvgs, webAwesomeThemeCss } from './assets.generated';
import { adoptWebAwesomeTheme, initialTheme } from './init';

const preferDark = (dark: boolean) => vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: dark }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('initialTheme', () => {
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

  it('falls back to the browser preference when there is no element yet', () => {
    preferDark(true);

    expect(initialTheme(undefined)).toEqual('dark');
  });

  it('falls back to the browser preference for an attribute naming neither theme', () => {
    preferDark(true);
    const el = document.createElement('div');
    el.setAttribute('theme', 'auto');

    expect(initialTheme(el)).toEqual('dark');
  });
});

const shadowRoot = (): ShadowRoot => document.createElement('div').attachShadow({ mode: 'open' });

describe('adoptWebAwesomeTheme', () => {
  it('gives a shadow root the theme', () => {
    const root = shadowRoot();
    adoptWebAwesomeTheme(root.host);

    expect(root.adoptedStyleSheets).toHaveLength(1);
  });

  it('adopts the same stylesheet into every root it is asked about', () => {
    const [one, two] = [shadowRoot(), shadowRoot()];
    adoptWebAwesomeTheme(one.host);
    adoptWebAwesomeTheme(two.host);

    expect(one.adoptedStyleSheets[0]).toBe(two.adoptedStyleSheets[0]);
  });

  it('leaves what a root already adopted alone, and adopts nothing twice', () => {
    const root = shadowRoot();
    const own = new CSSStyleSheet();
    root.adoptedStyleSheets = [own];

    adoptWebAwesomeTheme(root.host);
    adoptWebAwesomeTheme(root.host);

    expect(root.adoptedStyleSheets).toHaveLength(2);
    expect(root.adoptedStyleSheets[0]).toBe(own);
  });

  it('does nothing for an element with no shadow root', () => {
    expect(() => adoptWebAwesomeTheme(document.createElement('div'))).not.toThrow();
  });
});

describe('the inlined theme', () => {
  it('carries the stylesheets the theme imports, not just the theme', () => {
    expect(webAwesomeThemeCss).toContain('--wa-color-danger-on-normal');
    expect(webAwesomeThemeCss).not.toContain('@import');
  });
});

describe('the default icon library', () => {
  const iconUrl = async (name: string): Promise<string> => String(await getIconLibrary('default')!.resolver(name, 'default', 'regular', false));

  it('answers with the icon itself', async () => {
    const [type, encoded] = (await iconUrl('list')).split(',');

    expect(type).toEqual('data:image/svg+xml');
    expect(decodeURIComponent(encoded)).toEqual(iconSvgs['list']);
  });

  it('answers with a URL fetch resolves to the icon', async () => {
    const response = await fetch(await iconUrl('list'));

    expect(await response.text()).toEqual(iconSvgs['list']);
  });

  it('answers with nothing for a name it has no icon for', async () => {
    expect(await iconUrl('nonesuch')).toEqual('');
  });
});
