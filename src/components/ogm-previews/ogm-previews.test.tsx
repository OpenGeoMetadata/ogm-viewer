import { describe, it, expect, h, vi } from '@stencil/vitest';
// Render with Stencil's low-level render directly rather than @stencil/vitest's `render` wrapper: the
// wrapper re-throws lifecycle errors, and the <ogm-map> mounted inside a preview panel throws when it
// tries to initialize WebGL (unavailable in the test DOM). Stencil's own safeCall only routes that to
// console.error, so stencilRender still produces the ogm-previews shadow DOM we want to assert on.
import { render as stencilRender } from '@stencil/core';

import OgmRecord from '../../lib/record';

// Build a minimal Aardvark record, optionally with a WMS reference that yields one previewable source
const buildRecord = (previewable: boolean) =>
  new OgmRecord({
    id: 'berkeley-s7sq63',
    dct_title_s: 'Calaveras County Contours',
    gbl_resourceClass_sm: ['Datasets'],
    dct_accessRights_s: 'Public',
    gbl_mdVersion_s: 'Aardvark',
    ...(previewable
      ? {
          gbl_wxsIdentifier_s: 's7sq63',
          dct_references_s: JSON.stringify({ 'http://www.opengis.net/def/serviceType/ogc/wms': 'https://example.com/geoserver/wms' }),
        }
      : {}),
  });

const renderPreviews = async (record?: OgmRecord) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  // The mounted <ogm-map> logs a swallowed WebGL init error; keep test output clean
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  await stencilRender(<ogm-previews record={record}></ogm-previews>, container);
  const el = container.firstElementChild as HTMLElement & { componentOnReady?: () => Promise<unknown> };
  await el.componentOnReady?.();
  consoleError.mockRestore();
  return el.shadowRoot as ShadowRoot;
};

// Let Stencil's RAF-based update cycle flush so the nested <ogm-preview> renders its own shadow DOM.
const flush = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

// Render previews and drill into the single <ogm-preview> to see which preview (map or image) it
// chose. Going through <ogm-previews> means the source is constructed in the built component's module
// realm, so <ogm-preview>'s `instanceof IIIFSource` check holds (unlike a source built in the test).
const renderPreviewChild = async (record: OgmRecord) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  await stencilRender(<ogm-previews record={record}></ogm-previews>, container);
  const el = container.firstElementChild as HTMLElement & { componentOnReady?: () => Promise<unknown> };
  await el.componentOnReady?.();
  const preview = (el.shadowRoot as ShadowRoot).querySelector('ogm-preview') as HTMLElement & { componentOnReady?: () => Promise<unknown> };
  await preview?.componentOnReady?.();
  await flush();
  consoleError.mockRestore();
  return preview.shadowRoot as ShadowRoot;
};

// A minimal Aardvark record whose only reference is the given previewable one
const buildRecordWith = (references: Record<string, string>) =>
  new OgmRecord({
    id: 'test-record',
    dct_title_s: 'Test Record',
    gbl_resourceClass_sm: ['Datasets'],
    dct_accessRights_s: 'Public',
    gbl_mdVersion_s: 'Aardvark',
    dct_references_s: JSON.stringify(references),
  });

describe('ogm-previews', () => {
  it('renders a tab for a record supplied at initial render', async () => {
    const shadowRoot = await renderPreviews(buildRecord(true));

    const tabs = shadowRoot.querySelectorAll('wa-tab');
    expect(shadowRoot.querySelector('wa-tab-group')).not.toBeNull();
    expect(tabs).toHaveLength(1);
    expect(tabs[0].textContent).toContain('WMS');
  });

  it('falls back to an empty map for a record with no previewable sources', async () => {
    const shadowRoot = await renderPreviews(buildRecord(false));

    expect(shadowRoot.querySelector('wa-tab-group')).toBeNull();
    expect(shadowRoot.querySelector('ogm-map')).not.toBeNull();
  });

  it('wraps a map source in an ogm-preview that renders the map', async () => {
    const previewShadow = await renderPreviewChild(buildRecordWith({ 'http://geojson.org/geojson-spec.html': 'https://example.com/data.json' }));

    expect(previewShadow.querySelector('ogm-map')).not.toBeNull();
    expect(previewShadow.querySelector('ogm-image')).toBeNull();
  });

  it('wraps a IIIF image source in an ogm-preview that renders the image viewer', async () => {
    const previewShadow = await renderPreviewChild(buildRecordWith({ 'http://iiif.io/api/image': 'https://example.com/iiif/info.json' }));

    expect(previewShadow.querySelector('ogm-image')).not.toBeNull();
    expect(previewShadow.querySelector('ogm-map')).toBeNull();
  });
});
