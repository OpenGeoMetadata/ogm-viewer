import { render, describe, it, expect, h } from '@stencil/vitest';
import type { MapGeoJSONFeature } from 'maplibre-gl';

// A WMS GetFeatureInfo response, where attributes that don't apply to the feature come back null
const feature = {
  type: 'Feature',
  id: 'cugir007741.1',
  geometry: { type: 'Point', coordinates: [-73.903384, 44.365321] },
  properties: { region: 5, stat_name: 'EMN - WHITEFACE MT. SMT', ozone: 'Y', pm_2_5: null },
} as unknown as MapGeoJSONFeature;

const rows = (root: HTMLElement) =>
  Array.from((root.shadowRoot as ShadowRoot).querySelectorAll('tbody tr')).map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.textContent));

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
});
