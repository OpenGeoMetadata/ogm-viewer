import { render, describe, it, expect, h, vi, afterEach } from '@stencil/vitest';
import type { MapGeoJSONFeature } from 'maplibre-gl';

import type { References } from '../../lib/references';

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

// A second sheet with a picture of its own, for paging between two of them
const SHEET_WITH_PICTURE = sheet({
  label: 'SB 25',
  title: 'San Jose',
  websiteUrl: 'https://collections.lib.uwm.edu/digital/collection/agdm/id/4950/',
  thumbUrl: 'https://collections.lib.uwm.edu/digital/api/singleitem/image/agdm/4950/default.jpg',
});

const rows = (root: HTMLElement) =>
  Array.from((root.shadowRoot as ShadowRoot).querySelectorAll('tbody tr')).map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.textContent));

const shadow = (root: HTMLElement) => root.shadowRoot as ShadowRoot;
const pagers = (root: HTMLElement) => Array.from(shadow(root).querySelectorAll<HTMLElement>('.header .page'));
const count = (root: HTMLElement) => shadow(root).querySelector('.count')?.textContent;
const title = (root: HTMLElement) => shadow(root).querySelector('.title')?.textContent;
const keys = (root: HTMLElement) => Array.from(shadow(root).querySelectorAll('tbody .key')).map(td => td.textContent);
const image = (root: HTMLElement) => shadow(root).querySelector('img.thumbnail');
const tabs = (root: HTMLElement) => Array.from(shadow(root).querySelectorAll<HTMLElement>('wa-tab'));

// Which view the popup is showing. Both panels are in the document at once - that is what a tab group
// is - so what a reader can see is the one marked active, not the one that exists.
const showing = (root: HTMLElement) =>
  Array.from(shadow(root).querySelectorAll<HTMLElement & { active: boolean }>('wa-tab-panel'))
    .filter(panel => panel.active)
    .map(panel => panel.getAttribute('name'));

// The tooltip a documented field's name is wired to. Wiring is what can be checked here - happy-dom
// delivers no real hover, and the hovering itself is Web Awesome's to get right (see `show` below).
const definitionFor = (root: HTMLElement, key: string) => {
  const anchor = Array.from(shadow(root).querySelectorAll('tbody .key .defined')).find(span => span.textContent === key);
  // wa-tooltip resolves the `for` it was given into an aria-labelledby on the anchor pointing at an
  // id of its own, so the wiring to follow is that one rather than the attribute handed in
  const labelledBy = anchor?.getAttribute('aria-labelledby');
  if (!labelledBy) return undefined;
  return shadow(root).getElementById(labelledBy)?.textContent;
};

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

// Ask for one of the two views, as a reader's click on its tab would. It has to be the tab group's
// own `active` rather than an actual click: happy-dom doesn't carry an event on a slotted child into
// the shadow tree that slots it, and wa-tab-group listens for the click inside its own, so a click
// lands nowhere (probed, not assumed). Everything downstream of that is real - wa-tab-group's
// setActiveTab, the wa-tab-show it emits, and the state here that listens for it. The click itself is
// Web Awesome's to get right, and is checked in a browser instead.
const show = async (root: HTMLElement, view: 'image' | 'attributes', waitForChanges: () => Promise<void>) => {
  const group = shadow(root).querySelector<HTMLElement & { active: string }>('wa-tab-group');
  if (group) group.active = view;
  await settle(waitForChanges);
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
      expect(title(root)).toEqual('Feature');

      await page(root, waitForChanges, 'next');

      expect(count(root)).toEqual('(2/2)');
      expect(rows(root)).toEqual([['recId', 'am002176']]);
    });

    // The bug this row exists to avoid: while the title lived in the table's own header, a long one
    // widened the table past the room it had and pushed the paging button out of the popup. A row
    // above the content has the popup's whole width to shrink the title inside.
    it('keeps the title and the paging out of the table they describe', async () => {
      const { root } = await render(<ogm-attributes features={SHEETS}></ogm-attributes>);

      expect(shadow(root).querySelector('.header')).not.toBeNull();
      expect(shadow(root).querySelector('thead')).toBeNull();
      expect(shadow(root).querySelector('table .header, table .title')).toBeNull();
      expect(shadow(root).querySelector('wa-scroller .header')).toBeNull();
    });
  });

  // An index map's sheets carry properties with names of their own, which is more than a table of raw
  // keys can say about them
  // A record can point at an FGDC or ISO 19110 document describing what its fields hold. Reading it
  // is field-definitions.ts's own concern and tested there; what matters here is what a table does
  // with the answer, and what it does without one.
  describe("naming fields from the record's own metadata", () => {
    // All this component does with References is hand it to fieldDefinitions, which reads these two
    // getters off it; the fetch below is what decides the answer. Each test names a document of its
    // own, because one read per URL is held for the life of the page.
    const referencesFor = (url: string) => ({ fgdcUrl: url, iso19110Url: undefined }) as unknown as References;

    const FGDC = `<metadata><eainfo><detailed>
      <attr><attrlabl>REGION</attrlabl><attrdef>The DEC region where the station is located.</attrdef></attr>
      <attr>
        <attrlabl>OZONE</attrlabl>
        <attrdef>Whether the station measures ozone.</attrdef>
        <attrdomv><edom><edomv>Y</edomv><edomvd>Ozone is measured here</edomvd></edom></attrdomv>
      </attr>
    </detailed></eainfo></metadata>`;

    // A document read is a tick further off than a thumbnail: the fetch, its text, the parse, and
    // then the state that schedules the render. `settle` is built for the shorter of the two.
    const settleDefinitions = async (waitForChanges: () => Promise<void>) => {
      for (let tick = 0; tick < 4; tick++) await waitForChanges();
    };

    const respondWithFgdc = () =>
      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/xml' : null) },
        text: async () => FGDC,
      } as unknown as Response);

    it('explains a field the metadata defines, and leaves the rest as they came', async () => {
      respondWithFgdc();
      const { root, waitForChanges } = await render(<ogm-attributes features={[feature]} kind="wms" references={referencesFor('https://example.com/explains.xml')} />);
      await settleDefinitions(waitForChanges);

      expect(definitionFor(root, 'region')).toEqual('The DEC region where the station is located.');
      // stat_name is in the response but not in the document, so it keeps a plain name
      expect(definitionFor(root, 'stat_name')).toBeUndefined();
      expect(keys(root)).toEqual(['region', 'stat_name', 'ozone', 'pm_2_5']);
    });

    it('reads a coded value as what it means, keeping the code beside it', async () => {
      respondWithFgdc();
      const { root, waitForChanges } = await render(<ogm-attributes features={[feature]} kind="wms" references={referencesFor('https://example.com/coded.xml')} />);
      await settleDefinitions(waitForChanges);

      expect(rows(root)).toContainEqual(['ozone', 'Ozone is measured here (Y)']);
    });

    it('leaves a value the metadata has no code for alone', async () => {
      respondWithFgdc();
      const { root, waitForChanges } = await render(<ogm-attributes features={[feature]} kind="wms" references={referencesFor('https://example.com/uncoded.xml')} />);
      await settleDefinitions(waitForChanges);

      // REGION is defined but its values aren't coded, so 5 is still 5
      expect(rows(root)).toContainEqual(['region', '5']);
    });

    // The common case by a wide margin: most records point at no such document, or at one no
    // browser can read
    it('shows exactly what it always did for a record with no metadata to read', async () => {
      const { root, waitForChanges } = await render(<ogm-attributes features={[feature]} kind="wms" />);
      await settleDefinitions(waitForChanges);

      expect(rows(root)).toEqual([
        ['region', '5'],
        ['stat_name', 'EMN - WHITEFACE MT. SMT'],
        ['ozone', 'Y'],
        ['pm_2_5', ''],
      ]);
      expect(shadow(root).querySelectorAll('wa-tooltip')).toHaveLength(0);
    });

    it('says nothing extra when the document cannot be read', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 403, statusText: 'Forbidden', headers: { get: () => null } } as unknown as Response);
      const { root, waitForChanges } = await render(<ogm-attributes features={[feature]} kind="wms" references={referencesFor('https://example.com/refused.xml')} />);
      await settleDefinitions(waitForChanges);

      expect(rows(root)).toContainEqual(['ozone', 'Y']);
      expect(shadow(root).querySelectorAll('wa-tooltip')).toHaveLength(0);
    });
  });

  describe('describing an index map sheet', () => {
    afterEach(() => vi.restoreAllMocks());

    const renderSheet = async (features: MapGeoJSONFeature[]) => {
      const rendered = await render(<ogm-attributes kind="openindexmap" features={features}></ogm-attributes>);
      // The picture is settled before any of these look, so nothing is asserted against a half-decided view
      await settle(rendered.waitForChanges);
      return rendered;
    };

    const showProperties = (root: HTMLElement, waitForChanges: () => Promise<void>) => show(root, 'attributes', waitForChanges);

    describe('the properties', () => {
      it('names them the way the spec does rather than showing their keys', async () => {
        const { root, waitForChanges } = await renderSheet([SHEET]);
        await showProperties(root, waitForChanges);

        expect(keys(root)).toEqual(['Sheet', 'Title', 'Digital holdings', 'Call number', 'Web link', 'Download']);
      });

      it('gives the ones that are always a link something to read instead of a URL', async () => {
        const { root, waitForChanges } = await renderSheet([SHEET]);
        await showProperties(root, waitForChanges);

        expect(cellLink(root, 'Web link')).toEqual({ text: 'View this map', href: SHEET.properties.websiteUrl });
        expect(cellLink(root, 'Download')).toEqual({ text: 'Download this map', href: SHEET.properties.download });
      });

      // digHold is a link here but the spec lets it be a plain note, so it goes through the same
      // autolinking as any other value - which is why its text is the URL and the promoted ones' isn't
      it('leaves one that is only sometimes a link to the autolinker', async () => {
        const { root, waitForChanges } = await renderSheet([SHEET]);
        await showProperties(root, waitForChanges);

        expect(cellLink(root, 'Digital holdings')?.href).toEqual(SHEET.properties.digHold);
        expect(cellLink(root, 'Digital holdings')?.text).not.toEqual('View this map');
      });
    });

    // The picture is what you want when deciding which sheet you're after, so it's what a sheet opens
    // on - the properties are a tab away. Both share the popup rather than crowding into it.
    describe('choosing between the picture and the properties', () => {
      it('opens on the picture, pointed where the sheet points', async () => {
        const { root } = await renderSheet([SHEET]);

        expect(showing(root)).toEqual(['image']);
        expect(image(root)?.getAttribute('src')).toEqual(SHEET.properties.thumbUrl);
        expect(shadow(root).querySelector('a.thumbnail-link')?.getAttribute('href')).toEqual(SHEET.properties.websiteUrl);
      });

      // Both panels are in the document from the start, which is what a tab group is for - it means
      // coming back to the picture doesn't fetch it again. Only one of them is ever on screen.
      it('shows one or the other, never both', async () => {
        const { root, waitForChanges } = await renderSheet([SHEET]);
        expect(showing(root)).toEqual(['image']);

        await showProperties(root, waitForChanges);

        expect(showing(root)).toEqual(['attributes']);
        expect(shadow(root).querySelector('table')).not.toBeNull();
      });

      it('says what each of the two views is, and goes back to the picture when asked', async () => {
        const { root, waitForChanges } = await renderSheet([SHEET]);
        expect(tabs(root).map(tab => tab.textContent)).toEqual(['Image', 'Attributes']);

        await showProperties(root, waitForChanges);
        expect(showing(root)).toEqual(['attributes']);

        await show(root, 'image', waitForChanges);

        expect(showing(root)).toEqual(['image']);
      });

      // A strip of its own under the header, the same shape <ogm-previews> uses to switch between a
      // record's previews - not a button over the corner of the picture, which reads as part of it
      it('offers the two views as tabs, in a row of their own', async () => {
        const { root } = await renderSheet([SHEET]);

        expect(shadow(root).querySelector('.header wa-tab-group')).toBeNull();
        expect(shadow(root).querySelector('wa-tab-group')?.parentNode).toBe(shadow(root));
        expect(tabs(root).map(tab => tab.getAttribute('panel'))).toEqual(['image', 'attributes']);
      });

      it('takes the whole row when a header is already clearing the close button', async () => {
        const { root } = await renderSheet([SHEET]);

        expect(shadow(root).querySelector('.header')).not.toBeNull();
        expect(shadow(root).querySelector('wa-tab-group')?.classList.contains('topmost')).toBe(false);
      });

      // A reader comparing sheets shouldn't have to ask for the properties again on every one of them
      it('keeps the choice when paging to the next sheet', async () => {
        const { root, waitForChanges } = await renderSheet([SHEET, SHEET_WITH_PICTURE]);
        await showProperties(root, waitForChanges);

        await page(root, waitForChanges, 'next');
        await settle(waitForChanges);

        expect(keys(root)).toEqual(['Sheet', 'Title', 'Web link']);
        expect(showing(root)).toEqual(['attributes']);
      });

      // A new click is a fresh question, so it starts where a sheet starts
      it('goes back to the picture for a new set of features', async () => {
        const { root, waitForChanges } = await renderSheet([SHEET]);
        await showProperties(root, waitForChanges);

        (root as unknown as { features: MapGeoJSONFeature[] }).features = [SHEET_WITH_PICTURE];
        await settle(waitForChanges);

        expect(showing(root)).toEqual(['image']);
        expect(image(root)?.getAttribute('src')).toEqual(SHEET_WITH_PICTURE.properties.thumbUrl);
      });

      // A strip of one tab is a label, not a choice
      it('shows the properties, and no tabs, for a sheet with no picture at all', async () => {
        const { root } = await renderSheet([sheet({ label: 'SB 25' })]);

        expect(image(root)).toBeNull();
        expect(shadow(root).querySelector('wa-tab-group')).toBeNull();
        expect(keys(root)).toEqual(['Sheet']);
      });

      it('falls back to the properties when the picture it expected turns out not to exist', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 403, statusText: 'Forbidden' } as unknown as Response);

        const { root } = await renderSheet([sheet({ label: 'SHEET 3', iiifUrl: 'https://purl.stanford.edu/kh108fv7858/iiif/manifest' })]);

        expect(image(root)).toBeNull();
        expect(shadow(root).querySelector('wa-tab-group')).toBeNull();
        expect(keys(root)).toEqual(['Sheet', 'IIIF manifest']);
      });

      // Rather than showing the properties and swapping them out from under the reader once the
      // manifest answers. Whether there is a picture to wait for is known from the sheet itself.
      it('waits on a picture it knows is coming rather than showing the properties first', async () => {
        vi.spyOn(global, 'fetch').mockReturnValue(new Promise(() => {}) as Promise<Response>);

        const { root } = await renderSheet([sheet({ label: 'SHEET 3', iiifUrl: 'https://purl.stanford.edu/kh108fv7858/iiif/manifest' })]);

        expect(shadow(root).querySelector('wa-skeleton')).not.toBeNull();
        expect(showing(root)).toEqual(['image']);
      });

      // Knowing where a picture is isn't having it, and for a sheet carrying its own thumbUrl the
      // download is the whole wait - there is no manifest to read first. The frame is the picture's
      // size throughout either way, so what's at stake is whether the reader watches a placeholder
      // or an empty box.
      it('keeps the placeholder up until the picture has downloaded, not just until it is named', async () => {
        const { root, waitForChanges } = await renderSheet([SHEET]);

        expect(image(root)).not.toBeNull();
        expect(shadow(root).querySelector('wa-skeleton')).not.toBeNull();

        image(root)?.dispatchEvent(new Event('load'));
        await waitForChanges();

        expect(shadow(root).querySelector('wa-skeleton')).toBeNull();
        expect(image(root)).not.toBeNull();
      });

      // The same end as a sheet whose manifest named no picture, rather than a placeholder that
      // shimmers forever over an image that is never going to arrive
      it('falls through to the properties when the picture fails to download', async () => {
        const { root, waitForChanges } = await renderSheet([SHEET]);

        image(root)?.dispatchEvent(new Event('error'));
        await waitForChanges();

        expect(image(root)).toBeNull();
        expect(shadow(root).querySelector('wa-tab-group')).toBeNull();
        expect(keys(root)).toEqual(['Sheet', 'Title', 'Digital holdings', 'Call number', 'Web link', 'Download']);
      });

      it('paints the sheet a page away without waiting on its picture', async () => {
        const { root, waitForChanges } = await renderSheet([SHEET, SHEET_WITH_PICTURE]);

        await page(root, waitForChanges, 'next');

        expect(title(root)).toEqual('SB 25');
        expect(count(root)).toEqual('(2/2)');
      });
    });

    // Which is how Stanford's index maps carry a picture: an iiifUrl per sheet and no thumbUrl anywhere
    it("reads a picture out of the sheet's IIIF manifest when it has none of its own", async () => {
      const thumbnail = 'https://stacks.stanford.edu/image/iiif/kh108fv7858/full/!400,400/0/default.jpg';
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({ thumbnail: { '@id': thumbnail } }) } as unknown as Response);
      const iiifUrl = 'https://purl.stanford.edu/kh108fv7858/iiif/manifest';

      const { root } = await renderSheet([sheet({ label: 'SHEET 3', iiifUrl })]);

      expect(fetchSpy.mock.calls[0][0]).toEqual(iiifUrl);
      expect(image(root)?.getAttribute('src')).toEqual(thumbnail);
    });

    // The same sheet, from a plain GeoJSON layer or a GetFeatureInfo response: nothing tells us those
    // keys mean what the spec says they mean, and thumbUrl is just another column
    it('leaves a feature from anything else as a table of its own keys', async () => {
      const { root, waitForChanges } = await render(<ogm-attributes features={[SHEET]}></ogm-attributes>);
      await settle(waitForChanges);

      expect(keys(root)).toEqual(['label', 'title', 'instCallNo', 'digHold', 'websiteUrl', 'thumbUrl', 'download']);
      expect(image(root)).toBeNull();
      expect(shadow(root).querySelector('wa-tab-group')).toBeNull();
    });
  });
});
