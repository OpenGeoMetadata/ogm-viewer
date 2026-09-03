import { afterEach, describe, expect, h, it, vi } from '@stencil/vitest';
import { render } from '@stencil/vitest';

const response = {
  '@context': 'http://iiif.io/api/search/2/context.json',
  'id': 'https://example.org/search?q=Market',
  'type': 'AnnotationPage',
  'partOf': { id: 'https://example.org/search', type: 'AnnotationCollection', total: 1 },
  'items': [
    {
      'id': 'https://example.org/annotations/1',
      'type': 'Annotation',
      'body': { type: 'TextualBody', value: 'Market St.' },
      'target': {
        source: 'https://example.org/canvas/1',
        selector: { type: 'FragmentSelector', value: 'xywh=10,20,100,30' },
      },
      'myrdal:evidence': {
        confidence: 0.94,
        matched_by: 'gazetteer_entity',
        entity_matches: [{ id: 'place:1', label: 'Market Street', outcome: 'confirmed', query_match: true }],
      },
    },
  ],
};

afterEach(() => vi.unstubAllGlobals());

describe('ogm-search', () => {
  it('searches a IIIF service, explains the match, and emits the selected annotation', async () => {
    const fetch = vi.fn(async (_url: string) => new Response(JSON.stringify(response), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const { root, waitForChanges } = await render(<ogm-search searchUrl="https://example.org/search"></ogm-search>);
    const shadowRoot = root.shadowRoot as ShadowRoot;
    const input = shadowRoot.querySelector('input') as HTMLInputElement;
    input.value = 'Market';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await waitForChanges();
    shadowRoot.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await waitForChanges();
    await waitForChanges();

    const searchRequests = fetch.mock.calls.map(call => call[0]).filter(url => url.startsWith('https://example.org/search'));
    expect(searchRequests).toHaveLength(1);
    expect(new URL(searchRequests[0]).searchParams.get('q')).toBe('Market');
    expect(shadowRoot.textContent).toContain('1 match for “Market”');
    expect(shadowRoot.textContent).toContain('Matched through the gazetteer');
    expect(shadowRoot.textContent).toContain('Market Street · confirmed');

    const selected = vi.fn();
    root.addEventListener('contentSearchResultSelected', selected);
    (shadowRoot.querySelector('.result') as HTMLButtonElement).click();

    expect(selected).toHaveBeenCalledOnce();
    expect(selected.mock.calls[0][0].detail.id).toBe('https://example.org/annotations/1');
  });
});
