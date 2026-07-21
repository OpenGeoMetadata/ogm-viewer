import { render, describe, it, expect, h } from '@stencil/vitest';

import { referenceError } from '../../lib/errors';

// Mock a network failure on load
const makeError = (url?: string) => referenceError(new TypeError('Failed to fetch'), 'GeoJSON', url);

describe('ogm-alerts', () => {
  it('renders nothing when there is no error', async () => {
    const { root } = await render(<ogm-alerts></ogm-alerts>);
    const shadowRoot = root.shadowRoot as ShadowRoot;
    expect(shadowRoot.querySelector('.alerts')).toBeNull();
  });

  it('renders a danger callout with the error title, message, and url', async () => {
    const { root } = await render(<ogm-alerts error={makeError('http://example.com/data.json')}></ogm-alerts>);
    const shadowRoot = root.shadowRoot as ShadowRoot;

    const callout = shadowRoot.querySelector('wa-callout');
    expect(callout).not.toBeNull();
    expect(callout!.getAttribute('variant')).toBe('danger');
    expect(callout!.textContent).toContain('GeoJSON');
    expect(callout!.textContent).toContain('CORS');
    expect(callout!.textContent).toContain('http://example.com/data.json');
  });

  it('omits the url line when the error has no url', async () => {
    const { root } = await render(<ogm-alerts error={makeError()}></ogm-alerts>);
    const shadowRoot = root.shadowRoot as ShadowRoot;
    expect(shadowRoot.querySelector('.url')).toBeNull();
  });
});
