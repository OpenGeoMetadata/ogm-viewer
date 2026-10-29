import { describe, it, expect, h, vi } from '@stencil/vitest';
import { render as stencilRender } from '@stencil/core';

import OgmRecord from '../../lib/record';
import GeoJsonResource from '../../lib/resources/geojson';
import OpenIndexMapResource from '../../lib/resources/openindexmap';
import GeoJsonPreviewer from '../../lib/previewers/geojson';
import OpenIndexMapPreviewer from '../../lib/previewers/openindexmap';
import type { AnyPreviewer } from '../../lib/previewers/factory';

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

const mountPreviews = async (record?: OgmRecord, previewers?: AnyPreviewer[], beforeId?: string) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  await stencilRender(<ogm-previews record={record} previewers={previewers} beforeId={beforeId}></ogm-previews>, container);
  const el = container.firstElementChild as HTMLElement & { record?: OgmRecord; beforeId?: string; componentOnReady?: () => Promise<unknown> };
  await el.componentOnReady?.();
  await flush();
  consoleError.mockRestore();
  return el;
};

const renderPreviews = async (record?: OgmRecord, previewers?: AnyPreviewer[]) => (await mountPreviews(record, previewers)).shadowRoot as ShadowRoot;

const buildPreviewers = (): AnyPreviewer[] => [
  new GeoJsonPreviewer(new GeoJsonResource('my-layer', 'https://example.com/data.json')),
  new OpenIndexMapPreviewer(new OpenIndexMapResource('my-index', 'https://example.com/index.geojson')),
];

const flush = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

const renderPreviewChild = async (record: OgmRecord) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  await stencilRender(<ogm-previews record={record}></ogm-previews>, container);
  const el = container.firstElementChild as HTMLElement & { componentOnReady?: () => Promise<unknown> };
  await el.componentOnReady?.();
  await flush();
  const preview = (el.shadowRoot as ShadowRoot).querySelector('ogm-preview') as HTMLElement & { componentOnReady?: () => Promise<unknown> };
  await preview?.componentOnReady?.();
  await flush();
  consoleError.mockRestore();
  return preview.shadowRoot as ShadowRoot;
};

const buildRecordWith = (references: Record<string, string>, id = 'test-record') =>
  new OgmRecord({
    id,
    dct_title_s: 'Test Record',
    gbl_resourceClass_sm: ['Datasets'],
    dct_accessRights_s: 'Public',
    gbl_mdVersion_s: 'Aardvark',
    dct_references_s: JSON.stringify(references),
  });

const highlighted = (shadowRoot: ShadowRoot) =>
  Array.from(shadowRoot.querySelectorAll('wa-tab'))
    .filter(tab => tab.active)
    .map(tab => tab.panel);
const showing = (shadowRoot: ShadowRoot) =>
  Array.from(shadowRoot.querySelectorAll('wa-tab-panel'))
    .filter(panel => panel.active)
    .map(panel => panel.name);

const openTab = (shadowRoot: ShadowRoot, index: number) => {
  Array.from(shadowRoot.querySelectorAll('wa-tab')).forEach((tab, idx) => (tab.active = idx === index));
  Array.from(shadowRoot.querySelectorAll('wa-tab-panel')).forEach((panel, idx) => (panel.active = idx === index));
};

describe('ogm-previews', () => {
  it('renders a tab for a record supplied at initial render', async () => {
    const shadowRoot = await renderPreviews(buildRecord(true));

    const tabs = shadowRoot.querySelectorAll('wa-tab');
    expect(shadowRoot.querySelector('wa-tab-group')).not.toBeNull();
    expect(tabs).toHaveLength(1);
    expect(tabs[0].textContent).toContain('WMS');
  });

  it('renders nothing for a record with no previewable sources', async () => {
    const shadowRoot = await renderPreviews(buildRecord(false));

    expect(shadowRoot.querySelector('wa-tab-group')).toBeNull();
    expect(shadowRoot.querySelectorAll('wa-tab')).toHaveLength(0);
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

  it('gives every preview its own tab, and every tab its own panel', async () => {
    const shadowRoot = await renderPreviews(
      buildRecordWith({
        'http://iiif.io/api/image': 'https://example.com/iiif/info.json',
        'http://geojson.org/geojson-spec.html': 'https://example.com/data.json',
      }),
    );

    const tabs = Array.from(shadowRoot.querySelectorAll('wa-tab'));
    const panels = Array.from(shadowRoot.querySelectorAll('wa-tab-panel'));

    expect(tabs.map(tab => tab.textContent?.trim())).toEqual(['IIIF Image', 'GeoJSON']);
    expect(tabs.map(tab => tab.getAttribute('panel'))).toEqual(panels.map(panel => panel.getAttribute('name')));
    expect(shadowRoot.querySelectorAll('ogm-preview')).toHaveLength(2);
  });

  it('starts the new record on its first preview, whichever tab was open on the last one', async () => {
    const el = await mountPreviews(
      buildRecordWith({
        'http://iiif.io/api/image': 'https://example.com/iiif/info.json',
        'https://openindexmaps.org': 'https://example.com/index.geojson',
        'http://geojson.org/geojson-spec.html': 'https://example.com/data.json',
        'https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames': 'https://example.com/{z}/{x}/{y}.png',
      }),
    );
    const shadowRoot = el.shadowRoot as ShadowRoot;
    openTab(shadowRoot, 1);

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const loaded = new Promise(resolve => el.addEventListener('previewsLoaded', resolve, { once: true }));
    el.record = buildRecordWith(
      { 'http://iiif.io/api/image': 'https://example.com/other/info.json', 'http://geojson.org/geojson-spec.html': 'https://example.com/other.json' },
      'other-record',
    );
    await loaded;
    await flush();
    consoleError.mockRestore();

    expect(showing(shadowRoot)).toEqual(['other-record-iiif-image-image']);
    expect(highlighted(shadowRoot).filter(panel => !showing(shadowRoot).includes(panel))).toEqual([]);
  });

  describe('previews handed over rather than worked out from a record', () => {
    it('renders a tab and a panel for each, with no record at all', async () => {
      const shadowRoot = await renderPreviews(undefined, buildPreviewers());

      const tabs = Array.from(shadowRoot.querySelectorAll('wa-tab'));
      const panels = Array.from(shadowRoot.querySelectorAll('wa-tab-panel'));

      expect(tabs.map(tab => tab.textContent?.trim())).toEqual(['GeoJSON', 'Index Map']);
      expect(tabs.map(tab => tab.getAttribute('panel'))).toEqual(panels.map(panel => panel.getAttribute('name')));
      expect(shadowRoot.querySelectorAll('ogm-preview')).toHaveLength(2);
    });

    it('shows only these, even when a previewable record is there too', async () => {
      const shadowRoot = await renderPreviews(buildRecord(true), buildPreviewers());

      expect(Array.from(shadowRoot.querySelectorAll('wa-tab')).map(tab => tab.textContent?.trim())).toEqual(['GeoJSON', 'Index Map']);
    });

    it('renders nothing when handed an empty list', async () => {
      const shadowRoot = await renderPreviews(undefined, []);

      expect(shadowRoot.querySelector('wa-tab-group')).toBeNull();
    });
  });

  describe('beforeId', () => {
    const drawnBeforeIds = (el: HTMLElement) =>
      Array.from((el.shadowRoot as ShadowRoot).querySelectorAll('ogm-preview'))
        .map(preview => (preview as HTMLElement & { previewer: AnyPreviewer }).previewer)
        .map(previewer => (previewer.renderer === 'map' ? previewer.beforeId : null));

    it('is handed to every map preview built from the record', async () => {
      const el = await mountPreviews(buildRecord(true), undefined, 'water');

      expect(drawnBeforeIds(el)).toEqual(['water']);
    });

    it("leaves them the library's own default when there is none", async () => {
      const el = await mountPreviews(buildRecord(true));

      expect(drawnBeforeIds(el)).toEqual(['watername_ocean']);
    });

    it('is handed over again when it changes, and the default comes back when it is unset', async () => {
      const el = await mountPreviews(buildRecord(true), undefined, 'water');

      el.beforeId = '';
      expect(drawnBeforeIds(el)).toEqual(['']);

      el.beforeId = undefined;
      expect(drawnBeforeIds(el)).toEqual(['watername_ocean']);
    });

    it('leaves previews that were handed over with their own', async () => {
      const previewers = buildPreviewers();
      previewers.forEach(previewer => previewer.renderer === 'map' && (previewer.beforeId = 'roads'));
      const el = await mountPreviews(undefined, previewers, 'water');

      expect(drawnBeforeIds(el)).toEqual(['roads', 'roads']);
    });
  });
});
