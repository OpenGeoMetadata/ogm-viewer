import { render, describe, it, expect, h } from '@stencil/vitest';

import type { LayerControl } from '../../lib/layers';
import type { LegendEntry } from '../../lib/legend';

const item = (id: string, title: string, overrides: Partial<LayerControl> = {}): LayerControl => ({ id, title, visible: true, opacity: 1, ...overrides });

const RAMPED = item('elevation', 'Groundwater Elevation', { colorRamp: 'viridis', colorRampRange: [-184.48, 607.27] });
const VECTOR = item('districts', 'Districts');

const renderLegend = async (layers: LayerControl[] = [], entries: LegendEntry[] = []) => {
  const { root } = await render(<ogm-legend layers={layers} entries={entries}></ogm-legend>);
  return root.shadowRoot as ShadowRoot;
};

describe('ogm-legend', () => {
  it('shows nothing while nothing drawn has a ramp', async () => {
    const shadowRoot = await renderLegend([VECTOR]);
    expect(shadowRoot.querySelector('.panel')).toBeNull();
  });

  it('shows nothing for an empty layer list', async () => {
    const shadowRoot = await renderLegend([]);
    expect(shadowRoot.querySelector('.panel')).toBeNull();
  });

  it('shows named color swatches without a ramped layer', async () => {
    const entries = [
      { label: 'Available map', color: '#123456' },
      { label: 'Unavailable map', color: '#abcdef' },
      { label: 'Selected map', color: '#fedcba' },
    ];
    const shadowRoot = await renderLegend([], entries);

    expect(Array.from(shadowRoot.querySelectorAll('.swatch-entry')).map(el => el.textContent?.trim())).toEqual(entries.map(entry => entry.label));
    expect(Array.from(shadowRoot.querySelectorAll<HTMLElement>('.swatch')).map(el => el.style.backgroundColor)).toEqual(entries.map(entry => entry.color));
  });

  it('shows nothing without either named colors or a ramp', async () => {
    const shadowRoot = await renderLegend();
    expect(shadowRoot.querySelector('.panel')).toBeNull();
  });

  it("labels an entry with the layer's own title", async () => {
    const shadowRoot = await renderLegend([RAMPED]);
    expect(shadowRoot.querySelector('.entry .title')?.textContent).toEqual('Groundwater Elevation');
  });

  // The gap between the labels is coarse enough here that formatValue rounds to whole numbers -
  // see colormap.test.ts for formatValue itself; this only checks the legend hands it the right
  // two numbers, in the right order.
  it("labels the bar's ends with the layer's own value range", async () => {
    const shadowRoot = await renderLegend([RAMPED]);
    expect(shadowRoot.querySelector('.min')?.textContent).toEqual('-184');
    expect(shadowRoot.querySelector('.max')?.textContent).toEqual('607');
  });

  it('lists only the rampable layers, in a mix with ordinary ones', async () => {
    const shadowRoot = await renderLegend([VECTOR, RAMPED]);
    expect(shadowRoot.querySelectorAll('.entry')).toHaveLength(1);
    expect(shadowRoot.querySelector('.entry .title')?.textContent).toEqual('Groundwater Elevation');
  });

  // A layer hidden or faded to nothing has nothing on screen for a legend to explain
  it('says nothing about a rampable layer that is not currently drawn', async () => {
    const hidden = item('elevation', 'Groundwater Elevation', { visible: false, colorRamp: 'viridis', colorRampRange: [-184.48, 607.27] });
    const shadowRoot = await renderLegend([hidden]);
    expect(shadowRoot.querySelector('.panel')).toBeNull();
  });

  it('shows one entry per rampable layer, each with its own range', async () => {
    const second = item('temperature', 'Temperature Anomaly', { colorRamp: 'rdbu', colorRampRange: [-5, 5] });
    const shadowRoot = await renderLegend([RAMPED, second]);

    expect(shadowRoot.querySelectorAll('.entry')).toHaveLength(2);
    expect(Array.from(shadowRoot.querySelectorAll('.entry .title')).map(el => el.textContent)).toEqual(['Groundwater Elevation', 'Temperature Anomaly']);
  });

  // The sprite decodes here the way it does in a browser - happy-dom has no image pipeline of its
  // own, so vitest-setup-dom.ts supplies one. What's worth checking is that the bar carries this
  // layer's own ramp rather than just some gradient: a bar drawn from the wrong row of the sprite
  // would read as a different pair of colors entirely. The stops in between are rampGradient()'s
  // concern, covered without a DOM in colormap.test.ts; ogm-legend.no-sprite.test.tsx has what
  // happens when the sprite won't decode at all.
  it("draws the bar in the layer's own ramp", async () => {
    const shadowRoot = await renderLegend([RAMPED]);

    // Viridis, running from its dark purple end to its yellow one
    expect(shadowRoot.querySelector<HTMLElement>('.bar')?.style.background).toMatch(/^linear-gradient\(90deg, rgb\(68 1 84\),.*, rgb\(253 231 36\)\)$/);
  });

  it('names the legend for assistive technology', async () => {
    const shadowRoot = await renderLegend([RAMPED]);
    expect(shadowRoot.querySelector('.panel')?.getAttribute('aria-label')).toEqual('Legend');
  });
});
