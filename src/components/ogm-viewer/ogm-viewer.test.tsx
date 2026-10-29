import { describe, it, expect, h, vi, afterEach } from '@stencil/vitest';
import { render as stencilRender } from '@stencil/core';

const RECORD_URL = 'https://example.com/one.json';

const AARDVARK = {
  id: 'one',
  dct_title_s: 'One',
  gbl_resourceClass_sm: ['Datasets'],
  dct_accessRights_s: 'Public',
  gbl_mdVersion_s: 'Aardvark',
};

type Viewer = HTMLElement & { recordUrl?: string; componentOnReady?: () => Promise<unknown> };

const isIcon = (url: string) => url.startsWith('data:');

const serve = () => {
  const realFetch = globalThis.fetch;
  return vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (isIcon(url)) return realFetch(input, init);
    return url === RECORD_URL ? new Response(JSON.stringify(AARDVARK)) : new Response('not found', { status: 404 });
  });
};

const requested = (fetchSpy: ReturnType<typeof serve>) => fetchSpy.mock.calls.map(([input]) => String(input)).filter(url => !isIcon(url));

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
