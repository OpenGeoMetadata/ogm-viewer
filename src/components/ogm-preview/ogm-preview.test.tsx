import { describe, it, expect, h, vi } from '@stencil/vitest';

// Render with Stencil's low-level render directly rather than @stencil/vitest's `render` wrapper: the
// wrapper re-throws lifecycle errors, and the <ogm-map>/<ogm-image> mounted inside a preview throw
// when they try to initialize WebGL/OpenSeadragon (unavailable in the test DOM).
import { render as stencilRender } from '@stencil/core';

import GeoJSONSource from '../../lib/sources/geojson';
import { referenceError } from '../../lib/errors';

// Let Stencil's RAF-based update cycle flush after a state change (mirrors the vitest waitForChanges).
const flush = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

const renderPreview = async (source: GeoJSONSource) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  await stencilRender(<ogm-preview source={source}></ogm-preview>, container);
  const el = container.firstElementChild as HTMLElement & { componentOnReady?: () => Promise<unknown> };
  await el.componentOnReady?.();
  consoleError.mockRestore();
  return el;
};

describe('ogm-preview', () => {
  it('renders a preview for a source', async () => {
    const el = await renderPreview(new GeoJSONSource('id', 'http://example.com/data.json'));
    const shadowRoot = el.shadowRoot as ShadowRoot;
    expect(shadowRoot.querySelector('ogm-map')).not.toBeNull();
    expect(shadowRoot.querySelector('ogm-alerts')).toBeNull();
  });

  it('shows the error over the preview when a previewError is reported', async () => {
    const el = await renderPreview(new GeoJSONSource('id', 'http://example.com/data.json'));
    const error = referenceError(new TypeError('Failed to fetch'), 'GeoJSON', 'http://example.com/data.json');

    el.dispatchEvent(new CustomEvent('previewError', { detail: error, bubbles: true }));
    await flush();

    const shadowRoot = el.shadowRoot as ShadowRoot;
    expect(shadowRoot.querySelector('ogm-alerts')).not.toBeNull();
    // The preview stays mounted underneath so its in-flight load can finish and not leak loading state
    expect(shadowRoot.querySelector('ogm-map')).not.toBeNull();
  });
});
