import { render, describe, it, expect, h } from '@stencil/vitest';

import { getElement } from '../../lib/elements';
import type { LayerControl } from '../../lib/layers';

const item = (id: string, title: string, overrides: Partial<LayerControl> = {}): LayerControl => ({ id, title, visible: true, opacity: 1, ...overrides });

const ONE = [item('districts', 'Districts', { opacity: 0.8 })];
const TWO = [item('districts', 'Districts'), item('places', 'Places')];
const RAMPED = [item('elevation', 'Groundwater Elevation', { colorRamp: 'viridis', colorRampRange: [-184.48, 607.27] })];

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

  // A ramp picker is one more row in a layer's own <li>, not a control of its own - see
  // src/lib/previewers/cog-pipeline.ts for what actually makes a layer rampable.
  describe('a rampable layer', () => {
    it('shows no ramp picker for an ordinary layer', async () => {
      const shadowRoot = await renderLayers(ONE);
      expect(shadowRoot.querySelector('.ramps')).toBeNull();
    });

    it('shows a swatch for every offered ramp', async () => {
      const shadowRoot = await renderLayers(RAMPED);
      // One label wrapping one radio input per ramp - see COLOR_RAMPS in src/lib/colormap.ts
      expect(shadowRoot.querySelectorAll('.swatch')).toHaveLength(12);
      expect(shadowRoot.querySelectorAll('.swatch input[type="radio"]')).toHaveLength(12);
    });

    it("marks the layer's current ramp as the checked swatch, and no other", async () => {
      const shadowRoot = await renderLayers(RAMPED);
      const checked = Array.from(shadowRoot.querySelectorAll<HTMLInputElement>('.swatch input')).filter(input => input.checked);

      expect(checked).toHaveLength(1);
      expect(checked[0].value).toEqual('viridis');
    });

    it('groups the swatches as one radio group per layer, not shared across layers', async () => {
      const shadowRoot = await renderLayers([...RAMPED, item('other-cog', 'Other', { colorRamp: 'magma' })]);
      const names = new Set(Array.from(shadowRoot.querySelectorAll<HTMLInputElement>('.swatch input')).map(input => input.name));

      expect(names.size).toEqual(2);
    });

    it('reports when the user picks a different ramp', async () => {
      const { root, waitForChanges } = await render(<ogm-layers layers={RAMPED}></ogm-layers>);
      const changes: { id: string; colorRamp: string }[] = [];
      root.addEventListener('layerColorRampChange', (event: Event) => changes.push((event as CustomEvent<{ id: string; colorRamp: string }>).detail));

      const swatches = root.shadowRoot!.querySelectorAll<HTMLInputElement>('.swatch input');
      const magma = Array.from(swatches).find(input => input.value === 'magma')!;
      magma.checked = true;
      magma.dispatchEvent(new Event('change', { bubbles: true }));
      await waitForChanges();

      expect(changes).toEqual([{ id: 'elevation', colorRamp: 'magma' }]);
    });

    // The sprite decodes here the way it does in a browser - happy-dom has no image pipeline of its
    // own, so vitest-setup-dom.ts supplies one. What's worth proving is that each swatch is drawn
    // from its own row of the sprite rather than all twelve sharing one gradient: a swatch showing
    // some other ramp's colors is a picker that lies about what it selects. The gradient itself is
    // rampGradient()'s concern, covered without a DOM in colormap.test.ts, and
    // ogm-layers.no-sprite.test.tsx has what happens when the sprite won't decode at all.
    it('draws each swatch in the ramp it names', async () => {
      const shadowRoot = await renderLayers(RAMPED);
      const swatchFor = (ramp: string) => shadowRoot.querySelector<HTMLInputElement>(`.swatch input[value="${ramp}"]`)?.closest<HTMLElement>('.swatch');

      // Viridis runs dark purple to yellow, magma near-black to pale cream
      expect(swatchFor('viridis')?.style.background).toMatch(/^linear-gradient\(90deg, rgb\(68 1 84\),.*, rgb\(253 231 36\)\)$/);
      expect(swatchFor('magma')?.style.background).toMatch(/^linear-gradient\(90deg, rgb\(0 0 3\),.*, rgb\(251 252 191\)\)$/);
    });

    it('names the picker and each swatch for assistive technology', async () => {
      const shadowRoot = await renderLayers(RAMPED);

      expect(shadowRoot.querySelector('.ramps')?.getAttribute('aria-label')).toEqual('Color ramp for Groundwater Elevation');
      expect(shadowRoot.querySelector('.swatch input[value="viridis"]')?.getAttribute('aria-label')).toEqual('Viridis');
    });
  });
});
