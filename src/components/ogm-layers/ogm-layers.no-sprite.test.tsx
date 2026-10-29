import { render, describe, it, expect, vi, h } from '@stencil/vitest';

import type { LayerControl } from '../../lib/layers';

globalThis.createImageBitmap = () => Promise.reject(new Error('Broken sprite.'));

const RAMPED: LayerControl[] = [{ id: 'elevation', title: 'Groundwater Elevation', visible: true, opacity: 1, colorRamp: 'viridis', colorRampRange: [-184.48, 607.27] }];

describe('ogm-layers without a color ramp sprite', () => {
  it('still renders every swatch, and still picks, just without gradients', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { root } = await render(<ogm-layers layers={RAMPED}></ogm-layers>);
    const shadowRoot = root.shadowRoot as ShadowRoot;
    const swatches = shadowRoot.querySelectorAll<HTMLElement>('.swatch');

    expect(swatches).toHaveLength(12);
    expect(Array.from(swatches).every(swatch => swatch.style.background === '')).toBe(true);
    expect(shadowRoot.querySelector<HTMLInputElement>('.swatch input[value="viridis"]')?.checked).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('color ramp sprite'), expect.any(Error));
  });
});
