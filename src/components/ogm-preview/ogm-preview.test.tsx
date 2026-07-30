import { describe, it, expect, h, vi } from '@stencil/vitest';

// Render with Stencil's low-level render directly rather than @stencil/vitest's `render` wrapper: the
// wrapper re-throws lifecycle errors, and the <ogm-map>/<ogm-image> mounted inside a preview throw
// when they try to initialize WebGL/OpenSeadragon (unavailable in the test DOM).
import { render as stencilRender } from '@stencil/core';

import GeoJsonPreviewer from '../../lib/previewers/geojson';
import ImagePreviewer from '../../lib/previewers/image';
import GeoJsonResource from '../../lib/resources/geojson';
import IIIFResource from '../../lib/resources/iiif';
import type { AnyPreviewer } from '../../lib/previewers/factory';
import { referenceError } from '../../lib/errors';

// Let Stencil's RAF-based update cycle flush after a state change (mirrors the vitest waitForChanges).
const flush = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

const renderPreview = async (previewer: AnyPreviewer) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  await stencilRender(<ogm-preview previewer={previewer}></ogm-preview>, container);
  const el = container.firstElementChild as HTMLElement & { componentOnReady?: () => Promise<unknown> };
  await el.componentOnReady?.();
  consoleError.mockRestore();
  return el;
};

const mapPreviewer = () => new GeoJsonPreviewer(new GeoJsonResource('id', 'http://example.com/data.json'));

describe('ogm-preview', () => {
  it('draws a map preview with the map', async () => {
    const el = await renderPreview(mapPreviewer());
    const shadowRoot = el.shadowRoot as ShadowRoot;
    expect(shadowRoot.querySelector('ogm-map')).not.toBeNull();
    expect(shadowRoot.querySelector('ogm-image')).toBeNull();
    expect(shadowRoot.querySelector('ogm-alerts')).toBeNull();
  });

  // The previewer is built here, in the test's own module realm, while the component under test
  // comes from the built dist bundle. Routing on a string rather than a class is what lets these
  // two disagree about identity and still land in the right viewer.
  it('draws an image preview with the image viewer', async () => {
    const el = await renderPreview(new ImagePreviewer(new IIIFResource('id', 'http://example.com/iiif/info.json')));
    const shadowRoot = el.shadowRoot as ShadowRoot;
    expect(shadowRoot.querySelector('ogm-image')).not.toBeNull();
    expect(shadowRoot.querySelector('ogm-map')).toBeNull();
  });

  it('shows the error over the preview when a previewError is reported', async () => {
    const el = await renderPreview(mapPreviewer());
    const error = referenceError(new TypeError('Failed to fetch'), 'GeoJSON', 'http://example.com/data.json');

    el.dispatchEvent(new CustomEvent('previewError', { detail: error, bubbles: true }));
    await flush();

    const shadowRoot = el.shadowRoot as ShadowRoot;
    expect(shadowRoot.querySelector('ogm-alerts')).not.toBeNull();
    // The preview stays mounted underneath so its in-flight load can finish and not leak loading state
    expect(shadowRoot.querySelector('ogm-map')).not.toBeNull();
  });
});
