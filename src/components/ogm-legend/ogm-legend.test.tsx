import { render, describe, it, expect, h, vi } from '@stencil/vitest';

import type { LayerControl } from '../../lib/layers';
import type { LegendEntry, LegendImage } from '../../lib/legend';

const item = (id: string, title: string, overrides: Partial<LayerControl> = {}): LayerControl => ({ id, title, visible: true, opacity: 1, ...overrides });

const RAMPED = item('elevation', 'Groundwater Elevation', { colorRamp: 'viridis', colorRampRange: [-184.48, 607.27] });
const VECTOR = item('districts', 'Districts');

// The pair NASA GIBS publishes for a colormapped layer, in the order it lists them
const HORIZONTAL: LegendImage = { url: 'https://gibs.earthdata.nasa.gov/legends/GHRSST_Sea_Surface_Temperature_H.svg', format: 'image/svg+xml', width: 378, height: 86 };
const VERTICAL: LegendImage = { url: 'https://gibs.earthdata.nasa.gov/legends/GHRSST_Sea_Surface_Temperature_V.svg', format: 'image/svg+xml', width: 135, height: 288 };
const PICTURED = item('ghrsst', 'Sea Surface Temperature (L4, MUR, GHRSST)', { legendImages: [HORIZONTAL, VERTICAL] });

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

// happy-dom never downloads an <img>, so it never says whether one loaded: a picture that failed is
// told so here, the way a browser would tell it
const failToLoad = (img: HTMLImageElement | null | undefined) => img?.dispatchEvent(new Event('error'));

describe('ogm-legend with a legend picture', () => {
  // GIBS's pictures all carry a title of their own, which a second one over them would only repeat
  it("shows the service's picture without a title of the layer's over it", async () => {
    const shadowRoot = await renderLegend([PICTURED]);

    expect(shadowRoot.querySelector('.image-entry img')).not.toBeNull();
    expect(shadowRoot.querySelector('.image-entry .title')).toBeNull();
  });

  it('names the layer to assistive technology all the same', async () => {
    const shadowRoot = await renderLegend([PICTURED]);
    expect(shadowRoot.querySelector('.image-entry img')?.getAttribute('alt')).toEqual('Legend for Sea Surface Temperature (L4, MUR, GHRSST)');
  });

  // The panel is a strip in the corner of the map, which a picture as tall as GIBS's vertical one
  // would turn into a column
  it('shows the wide picture of the pair the service offers', async () => {
    const img = (await renderLegend([PICTURED])).querySelector<HTMLImageElement>('.image-entry img');
    expect(img?.src).toEqual(HORIZONTAL.url);
  });

  // So the space is there before the picture is, and the panel doesn't grow under the reader
  it('holds the size the service published for the picture', async () => {
    const img = (await renderLegend([PICTURED])).querySelector<HTMLImageElement>('.image-entry img');
    expect([img?.getAttribute('width'), img?.getAttribute('height')]).toEqual(['378', '86']);
  });

  it('leaves the picture to download only once it is on screen', async () => {
    const img = (await renderLegend([PICTURED])).querySelector<HTMLImageElement>('.image-entry img');
    expect(img?.getAttribute('loading')).toEqual('lazy');
  });

  it('frees the panel from the width a ramp bar is held to', async () => {
    expect((await renderLegend([PICTURED])).querySelector('.panel')?.classList.contains('has-images')).toBe(true);
    expect((await renderLegend([RAMPED])).querySelector('.panel')?.classList.contains('has-images')).toBe(false);
  });

  it('says nothing about a pictured layer that is not currently drawn', async () => {
    const shadowRoot = await renderLegend([{ ...PICTURED, visible: false }]);
    expect(shadowRoot.querySelector('.panel')).toBeNull();
  });

  it('lists a picture alongside a ramp, one entry each', async () => {
    const shadowRoot = await renderLegend([RAMPED, PICTURED]);
    expect(Array.from(shadowRoot.querySelectorAll('.entry')).map(el => el.classList.contains('image-entry'))).toEqual([false, true]);
  });

  it('shows the picture for the scale the map is at, and follows the map as it zooms', async () => {
    const overview = { url: 'https://example.org/legend/overview.png', minScaleDenominator: 1_000_000 };
    const detail = { url: 'https://example.org/legend/detail.png', maxScaleDenominator: 1_000_000 };
    const layer = item('roads', 'Roads', { legendImages: [overview, detail] });

    const { root, setProps } = await render(<ogm-legend layers={[layer]} zoom={6}></ogm-legend>);
    const shadowRoot = root.shadowRoot as ShadowRoot;
    expect(shadowRoot.querySelector<HTMLImageElement>('.image-entry img')?.src).toEqual(overview.url);

    await setProps({ zoom: 12 });
    expect(shadowRoot.querySelector<HTMLImageElement>('.image-entry img')?.src).toEqual(detail.url);
  });

  it('falls back to the other picture when the first will not load, and goes when neither will', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { root, waitForChanges } = await render(<ogm-legend layers={[PICTURED]}></ogm-legend>);
    const shadowRoot = root.shadowRoot as ShadowRoot;

    failToLoad(shadowRoot.querySelector('.image-entry img'));
    await waitForChanges();
    expect(shadowRoot.querySelector<HTMLImageElement>('.image-entry img')?.src).toEqual(VERTICAL.url);

    // The preview is still there without a legend; a broken-image icon in its corner explains nothing
    failToLoad(shadowRoot.querySelector('.image-entry img'));
    await waitForChanges();
    expect(shadowRoot.querySelector('.panel')).toBeNull();

    // Not silently, though
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(HORIZONTAL.url));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(VERTICAL.url));
    warn.mockRestore();
  });

  it('keeps the rest of the legend when a picture will not load', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { root, waitForChanges } = await render(<ogm-legend layers={[RAMPED, item('ghrsst', 'Sea Surface Temperature', { legendImages: [HORIZONTAL] })]}></ogm-legend>);
    const shadowRoot = root.shadowRoot as ShadowRoot;

    failToLoad(shadowRoot.querySelector('.image-entry img'));
    await waitForChanges();

    expect(shadowRoot.querySelector('.image-entry')).toBeNull();
    expect(shadowRoot.querySelector('.ramp-entry .title')?.textContent).toEqual('Groundwater Elevation');
    warn.mockRestore();
  });
});

type Details = HTMLElement & { open: boolean; show: () => Promise<void> };

const detailsOf = (root: HTMLElement) => (root.shadowRoot as ShadowRoot).querySelector('wa-details') as Details;

// A reader's click on the summary - "Legend", and the chevron beside it
const clickSummary = (details: Details) => (details.shadowRoot as ShadowRoot).querySelector<HTMLElement>('summary')?.click();

// Web Awesome slides the contents shut before it says the details has closed
const whenFolded = (details: Details) => new Promise(resolve => details.addEventListener('wa-after-hide', resolve, { once: true }));

describe('ogm-legend folding away', () => {
  it('starts unfolded, under a summary that names it', async () => {
    const { root } = await render(<ogm-legend layers={[PICTURED]}></ogm-legend>);

    expect(detailsOf(root).open).toBe(true);
    expect(detailsOf(root).shadowRoot?.querySelector('summary')?.textContent?.trim()).toEqual('Legend');
    expect(root.shadowRoot?.querySelector('.panel')?.classList.contains('folded')).toBe(false);
  });

  it('says so when the reader folds it away, and lets go of its width once it has', async () => {
    const { root, spyOnEvent, waitForChanges } = await render(<ogm-legend layers={[PICTURED]}></ogm-legend>);
    const toggled = spyOnEvent('legendToggle');
    const details = detailsOf(root);

    const folded = whenFolded(details);
    clickSummary(details);
    await folded;
    await waitForChanges();

    expect(details.open).toBe(false);
    expect(toggled.events.map(event => event.detail)).toEqual([false]);
    expect(root.shadowRoot?.querySelector('.panel')?.classList.contains('folded')).toBe(true);
  });

  it('says so when the reader unfolds it again', async () => {
    const { root, spyOnEvent, waitForChanges } = await render(<ogm-legend layers={[PICTURED]} open={false}></ogm-legend>);
    const toggled = spyOnEvent('legendToggle');

    await detailsOf(root).show();
    await waitForChanges();

    expect(toggled.events.map(event => event.detail)).toEqual([true]);
    expect(root.shadowRoot?.querySelector('.panel')?.classList.contains('folded')).toBe(false);
  });

  // Drawn again after a theme change, say, with the reader having folded it away before
  it('comes up folded when it was folded before', async () => {
    const { root } = await render(<ogm-legend layers={[PICTURED]} open={false}></ogm-legend>);

    expect(detailsOf(root).open).toBe(false);
    expect(root.shadowRoot?.querySelector('.panel')?.classList.contains('folded')).toBe(true);
  });
});
