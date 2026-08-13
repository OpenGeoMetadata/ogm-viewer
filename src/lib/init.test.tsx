import { describe, it, expect } from '@stencil/vitest';

import { waScope, webAwesomeReady } from './init';

// A stylesheet link and the element a component would have applied waScope() to, as they sit in a
// shadow root. Nothing here fetches anything: what a link does with its href is the browser's
// business, and what this cares about is only when it says it's finished.
const scoped = (color?: string) => {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  const scope = document.createElement('div');
  scope.className = waScope('light');
  // Declared on the element itself rather than inherited from above it, which is happy-dom's limit;
  // see MapLibreTheme's own tests. A color set here stands in for one the stylesheet brought.
  if (color) scope.style.setProperty('--wa-color-blue-50', color);
  document.body.append(link, scope);
  return { link, scope };
};

// Long enough for every microtask a promise chain queues to have run, so a promise that hasn't
// settled by now is one that is genuinely still waiting
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const watch = (promise: Promise<void>) => {
  const state = { ready: false };
  promise.then(() => (state.ready = true));
  return state;
};

describe('webAwesomeReady', () => {
  it('is ready straight away when the palette can already be read', async () => {
    const { link, scope } = scoped('#0071ec');

    const state = watch(webAwesomeReady(link, scope));
    await flush();

    expect(state.ready).toBe(true);
  });

  // The colors are a stylesheet away, and the wait is not optional: MapLibre rejects a layer whose
  // paint properties are the empty string rather than falling back to anything
  it('waits for the stylesheet when the palette has no colors behind it yet', async () => {
    const { link, scope } = scoped();

    const state = watch(webAwesomeReady(link, scope));
    await flush();
    expect(state.ready).toBe(false);

    link.dispatchEvent(new Event('load'));
    await flush();
    expect(state.ready).toBe(true);
  });

  // A theme that can't be fetched leaves a preview drawn in whatever its fallbacks come out as,
  // which is a good deal better than one that is never drawn at all
  it('gives up waiting on a stylesheet that fails to load', async () => {
    const { link, scope } = scoped();

    const state = watch(webAwesomeReady(link, scope));
    link.dispatchEvent(new Event('error'));
    await flush();

    expect(state.ready).toBe(true);
  });
});
