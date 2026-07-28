import { render, describe, it, expect, h } from '@stencil/vitest';

import { getElement } from '../../lib/elements';
import type { LayerControlItem } from '../../lib/layers';

const item = (id: string, title: string, overrides: Partial<LayerControlItem> = {}): LayerControlItem => ({ id, title, visible: true, opacity: 1, ...overrides });

const ONE = [item('districts', 'Districts', { opacity: 0.8 })];
const TWO = [item('districts', 'Districts'), item('places', 'Places')];

const renderLayers = async (layers: LayerControlItem[], open = false) => {
  const { root } = await render(<ogm-layers layers={layers} open={open}></ogm-layers>);
  return root.shadowRoot as ShadowRoot;
};

const titles = (shadowRoot: ShadowRoot) => Array.from(shadowRoot.querySelectorAll('.layer .title')).map(el => el.textContent);

describe('ogm-layers', () => {
  it('renders nothing while there is no preview to describe', async () => {
    const shadowRoot = await renderLayers([]);
    expect(shadowRoot.querySelector('.panel')).toBeNull();
  });

  // Nearly every record is a single layer, so the row is the whole panel - no header to open before
  // the reader can fade an overlay against the basemap
  it('gives a single layer no header to open', async () => {
    const shadowRoot = await renderLayers(ONE);

    expect(shadowRoot.querySelector('.header')).toBeNull();
    expect(titles(shadowRoot)).toEqual(['Districts']);
  });

  it('shows the opacity the theme draws the layer at', async () => {
    const shadowRoot = await renderLayers(ONE);

    expect(shadowRoot.querySelector<HTMLInputElement>('.opacity')?.value).toEqual('80');
    expect(shadowRoot.querySelector('.percent')?.textContent).toEqual('80%');
  });

  it('summarizes a real list and keeps it closed until asked', async () => {
    const shadowRoot = await renderLayers(TWO);

    expect(shadowRoot.querySelector('.header .title')?.textContent).toEqual('Layers (2)');
    expect(shadowRoot.querySelector('.disclosure')?.getAttribute('aria-expanded')).toEqual('false');
    expect(shadowRoot.querySelectorAll('.layer')).toHaveLength(0);
  });

  // MapLibre paints in the order layers were added, so the last is on top; reading the list
  // top-down should match reading the map top-down
  it('lists an open panel in the order the map draws it, topmost first', async () => {
    const shadowRoot = await renderLayers(TWO, true);

    expect(titles(shadowRoot)).toEqual(['Places', 'Districts']);
  });

  it('asks to be opened when the header is clicked', async () => {
    const { root, waitForChanges } = await render(<ogm-layers layers={TWO}></ogm-layers>);
    const toggled: boolean[] = [];
    root.addEventListener('layerListToggled', (event: Event) => toggled.push((event as CustomEvent<boolean>).detail));

    getElement(root, '.disclosure').click();
    await waitForChanges();

    expect(toggled).toEqual([true]);
  });

  it('reports which layer the reader hid', async () => {
    const { root, waitForChanges } = await render(<ogm-layers layers={TWO} open={true}></ogm-layers>);
    const changes: { id: string; visible: boolean }[] = [];
    root.addEventListener('layerVisibilityChange', (event: Event) => changes.push((event as CustomEvent<{ id: string; visible: boolean }>).detail));

    // Rows are reversed, so the first checkbox in the list is the topmost layer
    const checkbox = getElement(root, '.layer .visibility') as HTMLInputElement;
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    await waitForChanges();

    expect(changes).toEqual([{ id: 'places', visible: false }]);
  });

  // The 0-100 integer is the slider's business; everything below this component works in 0-1
  it('converts the slider percentage to a fraction', async () => {
    const { root, waitForChanges } = await render(<ogm-layers layers={ONE}></ogm-layers>);
    const changes: { id: string; opacity: number }[] = [];
    root.addEventListener('layerOpacityChange', (event: Event) => changes.push((event as CustomEvent<{ id: string; opacity: number }>).detail));

    const slider = getElement(root, '.opacity') as HTMLInputElement;
    slider.value = '40';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    await waitForChanges();

    expect(changes).toEqual([{ id: 'districts', opacity: 0.4 }]);
  });

  it('offers one switch for the whole list, so isolating a layer is two clicks', async () => {
    const { root, waitForChanges } = await render(<ogm-layers layers={TWO}></ogm-layers>);
    const changes: boolean[] = [];
    root.addEventListener('allLayersVisibilityChange', (event: Event) => changes.push((event as CustomEvent<boolean>).detail));

    const checkbox = getElement(root, '.header .visibility') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    await waitForChanges();

    expect(changes).toEqual([false]);
  });

  it('does not claim everything is shown when one layer is hidden', async () => {
    const shadowRoot = await renderLayers([item('districts', 'Districts'), item('places', 'Places', { visible: false })]);

    expect(shadowRoot.querySelector<HTMLInputElement>('.header .visibility')?.checked).toBe(false);
  });

  it('names every control, so the panel is usable from the keyboard', async () => {
    const shadowRoot = await renderLayers(ONE);

    expect(shadowRoot.querySelector('.panel')?.getAttribute('aria-label')).toEqual('Layer controls');
    expect(shadowRoot.querySelector('.layer .visibility')?.getAttribute('aria-label')).toEqual('Districts');
    expect(shadowRoot.querySelector('.opacity')?.getAttribute('aria-label')).toEqual('Opacity of Districts');
  });
});
