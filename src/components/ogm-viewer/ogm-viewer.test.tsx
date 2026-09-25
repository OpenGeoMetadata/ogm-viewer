import { describe, it, expect, h, vi, afterEach } from '@stencil/vitest';
// Stencil's own render rather than @stencil/vitest's wrapper, as in ogm-locator's tests: the wrapper
// re-throws whatever a lifecycle method leaves behind, and what's under test here is only which
// record the viewer ends up showing.
import { render as stencilRender } from '@stencil/core';

const RECORD_URL = 'https://example.com/one.json';

// No references and no geometry, so there is no preview to build below the viewer
const AARDVARK = {
  id: 'one',
  dct_title_s: 'One',
  gbl_resourceClass_sm: ['Datasets'],
  dct_accessRights_s: 'Public',
  gbl_mdVersion_s: 'Aardvark',
};

type Viewer = HTMLElement & { recordUrl?: string; componentOnReady?: () => Promise<unknown> };

// Every icon is a data URL. wa-icon fetches those too, but they never reach a server.
const isIcon = (url: string) => url.startsWith('data:');

// A server with one record on it. Anything else - a URL of "undefined", say - is a 404.
const serve = () => {
  const realFetch = globalThis.fetch;
  return vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (isIcon(url)) return realFetch(input, init);
    return url === RECORD_URL ? new Response(JSON.stringify(AARDVARK)) : new Response('not found', { status: 404 });
  });
};

// Every URL the viewer asked the server for, in order
const requested = (fetchSpy: ReturnType<typeof serve>) => fetchSpy.mock.calls.map(([input]) => String(input)).filter(url => !isIcon(url));

// Long enough for a mocked fetch's own microtasks to have run - see ogm-locator.test.tsx
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const containers: HTMLElement[] = [];

const mount = async (recordUrl: string) => {
  const container = document.createElement('div');
  containers.push(container);
  document.body.appendChild(container);
  await stencilRender(<ogm-viewer recordUrl={recordUrl}></ogm-viewer>, container);
  const el = container.firstElementChild as Viewer;
  await el.componentOnReady?.();
  await flush();
  return el;
};

// What the viewer is showing: the record its menubar was handed, and whether it put up an error
const showing = (el: Viewer) => {
  const root = el.shadowRoot as ShadowRoot;
  const menubar = root.querySelector('ogm-menubar') as HTMLElement & { record?: { id: string } };
  return { record: menubar.record?.id, error: !!root.querySelector('ogm-alerts') };
};

afterEach(() => {
  containers.splice(0).forEach(container => container.remove());
  vi.restoreAllMocks();
});

describe('ogm-viewer, given a URL', () => {
  it('fetches the record and shows it', async () => {
    serve();
    const el = await mount(RECORD_URL);

    expect(showing(el)).toEqual({ record: 'one', error: false });
  });

  it('shows nothing once the URL is taken away, rather than fetching one called "undefined"', async () => {
    const fetchSpy = serve();
    const el = await mount(RECORD_URL);

    el.recordUrl = undefined;
    await flush();

    expect(requested(fetchSpy)).toEqual([RECORD_URL]);
    expect(showing(el)).toEqual({ record: undefined, error: false });
  });

  // What a page's Clear button does before the same record is asked for again. Handing back the URL
  // the viewer already had would change nothing, so nothing would be fetched.
  it('fetches the same record again once its URL is taken away and handed back', async () => {
    const fetchSpy = serve();
    const el = await mount(RECORD_URL);

    el.recordUrl = undefined;
    await flush();
    el.recordUrl = RECORD_URL;
    await flush();

    expect(requested(fetchSpy)).toEqual([RECORD_URL, RECORD_URL]);
    expect(showing(el)).toEqual({ record: 'one', error: false });
  });
});
