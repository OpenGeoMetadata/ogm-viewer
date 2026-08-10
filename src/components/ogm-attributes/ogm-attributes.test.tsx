import { render, describe, it, expect, h, vi, afterEach } from '@stencil/vitest';
import type { MapGeoJSONFeature } from 'maplibre-gl';

// A WMS GetFeatureInfo response, where attributes that don't apply to the feature come back null
const feature = {
  type: 'Feature',
  id: 'cugir007741.1',
  geometry: { type: 'Point', coordinates: [-73.903384, 44.365321] },
  properties: { region: 5, stat_name: 'EMN - WHITEFACE MT. SMT', ozone: 'Y', pm_2_5: null },
} as unknown as MapGeoJSONFeature;

// One of the sheets an index map stacks at a point, as a click on the overlap returns them
const sheet = (properties: Record<string, string>) =>
  ({
    type: 'Feature',
    id: properties.recId,
    geometry: { type: 'Polygon', coordinates: [] },
    properties,
  }) as unknown as MapGeoJSONFeature;

const SHEETS = [sheet({ label: 'SB 24', recId: 'am002175' }), sheet({ label: 'SB 25', recId: 'am002176' })];

// The same stack from a source that names its features nothing we recognize as a label
const UNLABELED = [sheet({ recId: 'am002175' }), sheet({ recId: 'am002176' })];

// A sheet of the American Geographical Society's Millionth Map, as GeoBlacklight's own fixture
// carries it, trimmed to the properties this component does something with
const SHEET = sheet({
  label: 'SB 24',
  title: 'Jaguaribe',
  instCallNo: '050-b A-1:1,000,000',
  digHold: 'https://collections.lib.uwm.edu/digital/collection/agdm/id/4878/',
  websiteUrl: 'https://collections.lib.uwm.edu/digital/collection/agdm/id/4878/',
  thumbUrl: 'https://collections.lib.uwm.edu/digital/api/singleitem/image/agdm/4878/default.jpg',
  download: 'https://collections.lib.uwm.edu/digital/download/collection/agdm/id/4878/size/full',
});

const rows = (root: HTMLElement) =>
  Array.from((root.shadowRoot as ShadowRoot).querySelectorAll('tbody tr')).map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.textContent));

const shadow = (root: HTMLElement) => root.shadowRoot as ShadowRoot;
const pagers = (root: HTMLElement) => Array.from(shadow(root).querySelectorAll<HTMLElement>('.pagination wa-button'));
const count = (root: HTMLElement) => shadow(root).querySelector('.count')?.textContent;
const keys = (root: HTMLElement) => Array.from(shadow(root).querySelectorAll('tbody .key')).map(td => td.textContent);
const image = (root: HTMLElement) => shadow(root).querySelector('img.thumbnail');

// The one link in the row named by the given key, if it has one
const cellLink = (root: HTMLElement, key: string) => {
  const row = Array.from(shadow(root).querySelectorAll('tbody tr')).find(tr => tr.querySelector('.key')?.textContent === key);
  const link = row?.querySelector('a');
  return link ? { text: link.textContent, href: link.getAttribute('href') } : undefined;
};

// A thumbnail read out of a IIIF manifest is two awaits away from the render that asked for it, and
// the state it sets schedules one more
const settle = async (waitForChanges: () => Promise<void>) => {
  await waitForChanges();
  await waitForChanges();
};

const page = async (root: HTMLElement, waitForChanges: () => Promise<void>, direction: 'previous' | 'next') => {
  const [previous, next] = pagers(root);
  (direction === 'next' ? next : previous).click();
  await waitForChanges();
};

describe('ogm-attributes', () => {
  it('renders nothing without features', async () => {
    const { root } = await render(<ogm-attributes features={[]}></ogm-attributes>);
    expect((root.shadowRoot as ShadowRoot).querySelector('table')).toBeNull();
  });

  it('renders a row per attribute, leaving the value empty for a null', async () => {
    const { root } = await render(<ogm-attributes features={[feature]}></ogm-attributes>);
    expect(rows(root)).toEqual([
      ['region', '5'],
      ['stat_name', 'EMN - WHITEFACE MT. SMT'],
      ['ozone', 'Y'],
      ['pm_2_5', ''],
    ]);
  });

  it('offers no paging for a single feature', async () => {
    const { root } = await render(<ogm-attributes features={[feature]}></ogm-attributes>);
    expect(pagers(root)).toHaveLength(0);
  });

  describe('paging through features stacked at one point', () => {
    it('shows the first feature and its place in the stack', async () => {
      const { root } = await render(<ogm-attributes features={SHEETS}></ogm-attributes>);

      expect(count(root)).toEqual('(1/2)');
      expect(rows(root)).toEqual([
        ['label', 'SB 24'],
        ['recId', 'am002175'],
      ]);
    });

    it('keeps the table when paging to the next feature', async () => {
      const { root, waitForChanges } = await render(<ogm-attributes features={SHEETS}></ogm-attributes>);

      await page(root, waitForChanges, 'next');

      expect(shadow(root).querySelector('table')).not.toBeNull();
      expect(count(root)).toEqual('(2/2)');
      expect(rows(root)).toEqual([
        ['label', 'SB 25'],
        ['recId', 'am002176'],
      ]);
    });

    it('pages back to the feature before it', async () => {
      const { root, waitForChanges } = await render(<ogm-attributes features={SHEETS}></ogm-attributes>);

      await page(root, waitForChanges, 'next');
      await page(root, waitForChanges, 'previous');

      expect(count(root)).toEqual('(1/2)');
      expect(rows(root)).toEqual([
        ['label', 'SB 24'],
        ['recId', 'am002175'],
      ]);
    });

    it('reports the feature paged to, so the map can move its highlight', async () => {
      const { root, waitForChanges } = await render(<ogm-attributes features={SHEETS}></ogm-attributes>);
      const selected: MapGeoJSONFeature[] = [];
      root.addEventListener('featureSelected', (event: Event) => selected.push((event as CustomEvent<MapGeoJSONFeature>).detail));

      await page(root, waitForChanges, 'next');

      expect(selected).toEqual([SHEETS[1]]);
    });

    it('disables paging at each end of the stack', async () => {
      const { root, waitForChanges } = await render(<ogm-attributes features={SHEETS}></ogm-attributes>);
      const disabled = () => pagers(root).map(button => button.hasAttribute('disabled'));

      expect(disabled()).toEqual([true, false]);

      await page(root, waitForChanges, 'next');

      expect(disabled()).toEqual([false, true]);
    });

    it('offers paging even when nothing in the properties names the features', async () => {
      const { root, waitForChanges } = await render(<ogm-attributes features={UNLABELED}></ogm-attributes>);

      expect(pagers(root)).toHaveLength(2);
      expect(shadow(root).querySelector('.label')).toBeNull();

      await page(root, waitForChanges, 'next');

      expect(count(root)).toEqual('(2/2)');
      expect(rows(root)).toEqual([['recId', 'am002176']]);
    });
  });

  // An index map's sheets carry properties with names of their own, which is more than a table of raw
  // keys can say about them
  describe('describing an index map sheet', () => {
    afterEach(() => vi.restoreAllMocks());

    const renderSheet = (features: MapGeoJSONFeature[]) => render(<ogm-attributes kind="openindexmap" features={features}></ogm-attributes>);

    it('names the properties the way the spec does rather than showing their keys', async () => {
      const { root } = await renderSheet([SHEET]);

      expect(keys(root)).toEqual(['Sheet', 'Title', 'Digital holdings', 'Call number', 'Web link', 'Download']);
    });

    it('gives the properties that are always a link something to read instead of a URL', async () => {
      const { root } = await renderSheet([SHEET]);

      expect(cellLink(root, 'Web link')).toEqual({ text: 'View this map', href: SHEET.properties.websiteUrl });
      expect(cellLink(root, 'Download')).toEqual({ text: 'Download this map', href: SHEET.properties.download });
    });

    // digHold is a link here but the spec lets it be a plain note, so it goes through the same
    // autolinking as any other value - which is why its text is the URL and the promoted ones' isn't
    it('leaves a property that is only sometimes a link to the autolinker', async () => {
      const { root } = await renderSheet([SHEET]);

      expect(cellLink(root, 'Digital holdings')?.href).toEqual(SHEET.properties.digHold);
      expect(cellLink(root, 'Digital holdings')?.text).not.toEqual('View this map');
    });

    it('shows a picture of the sheet, pointed where the sheet points', async () => {
      const { root, waitForChanges } = await renderSheet([SHEET]);
      await waitForChanges();

      expect(image(root)?.getAttribute('src')).toEqual(SHEET.properties.thumbUrl);
      expect(shadow(root).querySelector('a.thumbnail-link')?.getAttribute('href')).toEqual(SHEET.properties.websiteUrl);
    });

    // Which is how Stanford's index maps carry a picture: an iiifUrl per sheet and no thumbUrl anywhere
    it("reads a picture out of the sheet's IIIF manifest when it has none of its own", async () => {
      const thumbnail = 'https://stacks.stanford.edu/image/iiif/kh108fv7858/full/!400,400/0/default.jpg';
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({ thumbnail: { '@id': thumbnail } }) } as unknown as Response);
      const iiifUrl = 'https://purl.stanford.edu/kh108fv7858/iiif/manifest';

      const { root, waitForChanges } = await renderSheet([sheet({ label: 'SHEET 3', iiifUrl })]);
      await settle(waitForChanges);

      expect(fetchSpy.mock.calls[0][0]).toEqual(iiifUrl);
      expect(image(root)?.getAttribute('src')).toEqual(thumbnail);
    });

    // The table is worth showing before the picture has arrived, so the first paint has one and not
    // the other
    it('shows the properties without waiting for the picture', async () => {
      vi.spyOn(global, 'fetch').mockReturnValue(new Promise(() => {}) as Promise<Response>);

      const { root } = await renderSheet([sheet({ label: 'SHEET 3', iiifUrl: 'https://purl.stanford.edu/kh108fv7858/iiif/manifest' })]);

      expect(keys(root)).toEqual(['Sheet', 'IIIF manifest']);
      expect(image(root)).toBeNull();
    });

    it('drops the picture when paged to a sheet that has none', async () => {
      const { root, waitForChanges } = await renderSheet([SHEET, sheet({ label: 'SB 25' })]);
      await waitForChanges();
      expect(image(root)).not.toBeNull();

      await page(root, waitForChanges, 'next');
      await settle(waitForChanges);

      expect(image(root)).toBeNull();
    });

    // The same sheet, from a plain GeoJSON layer or a GetFeatureInfo response: nothing tells us those
    // keys mean what the spec says they mean, and thumbUrl is just another column
    it('leaves a feature from anything else as a table of its own keys', async () => {
      const { root, waitForChanges } = await render(<ogm-attributes features={[SHEET]}></ogm-attributes>);
      await waitForChanges();

      expect(keys(root)).toEqual(['label', 'title', 'instCallNo', 'digHold', 'websiteUrl', 'thumbUrl', 'download']);
      expect(image(root)).toBeNull();
    });
  });
});
