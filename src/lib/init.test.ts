/** @vitest-environment happy-dom */
import { describe, it, expect, vi, afterEach } from 'vitest';

import { initialTheme } from './init';

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

  // An attribute naming neither theme isn't a statement about either one - it's read the same as no
  // attribute at all, rather than, say, coerced to whichever name it happens to resemble.
  it('falls back to the browser preference for an attribute naming neither theme', () => {
    preferDark(true);
    const el = document.createElement('div');
    el.setAttribute('theme', 'auto');

    expect(initialTheme(el)).toEqual('dark');
  });
});
