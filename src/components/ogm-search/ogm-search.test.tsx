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
      'thumbnail': [{ id: 'https://example.org/crop.jpg', type: 'Image', format: 'image/jpeg' }],
      'target': {
        source: 'https://example.org/canvas/1',
        selector: { type: 'FragmentSelector', value: 'xywh=10,20,100,30' },
      },
      'myrdal:evidence': {
        confidence: 0.94,
        matched_by: 'gazetteer_entity',
        ocr_text: 'Market St.',
        primary_entity: {
          id: 'place:1',
          label: 'Market Street',
          outcome: 'confirmed',
          query_match: true,
          properties: { source: 'gnis', canonical_entity_id: 'road:market', canonical_feature_group: 'road' },
        },
        entity_matches: [{ id: 'place:1', label: 'Market Street', outcome: 'confirmed', query_match: true }],
      },
    },
    {
      'id': 'https://example.org/annotations/2',
      'type': 'Annotation',
      'body': { type: 'TextualBody', value: 'Market Street' },
      'thumbnail': [{ id: 'https://example.org/crop-2.jpg', type: 'Image', format: 'image/jpeg' }],
      'target': {
        source: 'https://example.org/canvas/1',
        selector: { type: 'FragmentSelector', value: 'xywh=120,20,100,30' },
      },
      'myrdal:evidence': {
        matched_by: 'gazetteer_entity',
        ocr_text: 'MARKET STREET',
        primary_entity: {
          id: 'place:2',
          label: 'Market Street',
          query_match: true,
          properties: { source: 'overture', canonical_entity_id: 'road:market', canonical_feature_group: 'road' },
        },
      },
    },
  ],
};

afterEach(() => vi.unstubAllGlobals());

describe('ogm-search', () => {
  it('shows the best crop per entity and emits the selected annotation', async () => {
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
    expect(shadowRoot.textContent).toContain('1 result for “Market” · gazetteer matches');
    expect(shadowRoot.querySelectorAll('.entity-result')).toHaveLength(1);
    expect(shadowRoot.querySelectorAll('.entity-label')).toHaveLength(1);
    expect(shadowRoot.querySelector('.entity-metadata')?.textContent).toBe('Overture · road');
    expect(shadowRoot.textContent).not.toContain('candidate');
    const thumbnails = shadowRoot.querySelectorAll('.crop-thumbnail');
    expect(thumbnails).toHaveLength(1);
    expect((thumbnails[0] as HTMLImageElement).src).toBe('https://example.org/crop-2.jpg');

    const selected = vi.fn();
    root.addEventListener('contentSearchResultSelected', selected);
    (shadowRoot.querySelector('.crop-result') as HTMLButtonElement).click();

    expect(selected).toHaveBeenCalledOnce();
    expect(selected.mock.calls[0][0].detail.id).toBe('https://example.org/annotations/2');
  });
});
