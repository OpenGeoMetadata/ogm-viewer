import { render, describe, it, expect, h } from '@stencil/vitest';

import { getElement } from '../../lib/elements';
import type { LayerControl } from '../../lib/layers';

const item = (id: string, title: string, overrides: Partial<LayerControl> = {}): LayerControl => ({ id, title, visible: true, opacity: 1, ...overrides });

const ONE = [item('districts', 'Districts', { opacity: 0.8 })];
const TWO = [item('districts', 'Districts'), item('places', 'Places')];

const renderLayers = async (layers: LayerControl[]) => {
  const { root } = await render(<ogm-layers layers={layers}></ogm-layers>);
  return root.shadowRoot as ShadowRoot;
};

const titles = (shadowRoot: ShadowRoot) => Array.from(shadowRoot.querySelectorAll('.layer .title')).map(el => el.textContent);

describe('ogm-layers', () => {
  it('renders nothing while there is no preview to describe', async () => {
    const shadowRoot = await renderLayers([]);
    expect(shadowRoot.querySelector('.panel')).toBeNull();
  });

  it('does not render a header if there is only one layer', async () => {
    const shadowRoot = await renderLayers(ONE);

    expect(shadowRoot.querySelector('.header')).toBeNull();
    expect(titles(shadowRoot)).toEqual(['Districts']);
  });

  it('shows the current opacity percentage', async () => {
    const shadowRoot = await renderLayers(ONE);

    expect(shadowRoot.querySelector<HTMLInputElement>('.opacity')?.value).toEqual('80');
    expect(shadowRoot.querySelector('.percent')?.textContent).toEqual('80%');
  });

  it('renders a summary with layer count if there are multiple layers', async () => {
    const shadowRoot = await renderLayers(TWO);

    expect(shadowRoot.querySelector('.header .title')?.textContent).toEqual('Layers (2)');
    expect(shadowRoot.querySelectorAll('.layer')).toHaveLength(2);
  });

  it('lists the layers in the order the map draws them, topmost first', async () => {
    const shadowRoot = await renderLayers(TWO);

    expect(titles(shadowRoot)).toEqual(['Places', 'Districts']);
  });

  it('reports when the user hides layers', async () => {
    const { root, waitForChanges } = await render(<ogm-layers layers={TWO}></ogm-layers>);
    const changes: { id: string; visible: boolean }[] = [];
    root.addEventListener('layerVisibilityChange', (event: Event) => changes.push((event as CustomEvent<{ id: string; visible: boolean }>).detail));

    const checkbox = getElement(root, '.layer .visibility') as HTMLInputElement;
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    await waitForChanges();

    expect(changes).toEqual([{ id: 'places', visible: false }]);
  });

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

  it('supports toggling the visibility of all layers from the summary', async () => {
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

  it('updates the summary checkbox when a layer is hidden', async () => {
    const shadowRoot = await renderLayers([item('districts', 'Districts'), item('places', 'Places', { visible: false })]);

    expect(shadowRoot.querySelector<HTMLInputElement>('.header .visibility')?.checked).toBe(false);
  });

  it('adds aria labels to controls', async () => {
    const shadowRoot = await renderLayers(ONE);

    expect(shadowRoot.querySelector('.panel')?.getAttribute('aria-label')).toEqual('Layer controls');
    expect(shadowRoot.querySelector('.layer .visibility')?.getAttribute('aria-label')).toEqual('Districts');
    expect(shadowRoot.querySelector('.opacity')?.getAttribute('aria-label')).toEqual('Opacity of Districts');
  });
});
