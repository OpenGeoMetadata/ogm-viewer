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

  // happy-dom has neither createImageBitmap nor OffscreenCanvas, which decodeColormapSprite needs,
  // so this exercises the same fallback componentWillLoad's try/catch exists for in a real browser
  // asked to draw a genuinely broken sprite. The gradient itself is rampGradient()'s own concern,
  // covered directly and without a DOM in colormap.test.ts.
  it('still labels the range when the sprite fails to decode, just without a gradient', async () => {
    const shadowRoot = await renderLegend([RAMPED]);

    expect(shadowRoot.querySelector<HTMLElement>('.bar')?.style.background).toEqual('');
    expect(shadowRoot.querySelector('.min')?.textContent).toEqual('-184');
  });

  it('names the legend for assistive technology', async () => {
    const shadowRoot = await renderLegend([RAMPED]);
    expect(shadowRoot.querySelector('.panel')?.getAttribute('aria-label')).toEqual('Legend');
  });
});
