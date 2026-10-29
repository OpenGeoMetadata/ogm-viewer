import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';

import { adoptWebAwesomeTheme } from './init';

const LOADER = '../../www/build/ogm-viewer.esm.js';

const TAGS = ['ogm-viewer', 'ogm-locator', 'ogm-overview', 'ogm-alerts', 'ogm-preview', 'ogm-previews', 'ogm-map', 'ogm-image'];

const preferDark = (dark: boolean) => vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: dark }));

const themesNamed = (classes: string[]): string[] => [...new Set(classes.flatMap(className => className.split(' ')).filter(name => name === 'wa-light' || name === 'wa-dark'))];

const cssOf = (sheet: CSSStyleSheet): string =>
  Array.from(sheet.cssRules)
    .map(rule => rule.cssText)
    .join('\n');

const webAwesomeTheme = (): string => {
  const root = document.createElement('div').attachShadow({ mode: 'open' });
  adoptWebAwesomeTheme(root.host);
  return cssOf(root.adoptedStyleSheets[0]);
};

const mount = async (tag: string, theme?: 'light' | 'dark') => {
  const el = document.createElement(tag) as HTMLElement & { theme?: 'light' | 'dark' };
  const classes: string[] = [];
  new MutationObserver(records => records.forEach(record => classes.push((record.target as Element).className))).observe(el, {
    attributes: true,
    attributeFilter: ['class'],
  });
  if (theme) el.setAttribute('theme', theme);

  document.body.append(el);
  for (let i = 0; i < 80 && !el.classList.contains('hydrated'); i += 1) await new Promise(resolve => setTimeout(resolve, 25));
  return { el, classes };
};

beforeAll(async () => {
  await import(LOADER);

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

  it('renders with the Web Awesome theme in its own shadow root', async () => {
    const { el } = await mount(tag);

    expect((el.shadowRoot as ShadowRoot).adoptedStyleSheets.map(cssOf)).toContain(webAwesomeTheme());
  });
});
