import { render, describe, it, expect, h } from '@stencil/vitest';
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

const rows = (root: HTMLElement) =>
  Array.from((root.shadowRoot as ShadowRoot).querySelectorAll('tbody tr')).map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.textContent));

const shadow = (root: HTMLElement) => root.shadowRoot as ShadowRoot;
const pagers = (root: HTMLElement) => Array.from(shadow(root).querySelectorAll<HTMLElement>('.pagination wa-button'));
const count = (root: HTMLElement) => shadow(root).querySelector('.count')?.textContent;

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
});
