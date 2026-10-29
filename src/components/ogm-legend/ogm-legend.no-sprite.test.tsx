import { render, describe, it, expect, vi, h } from '@stencil/vitest';

import type { LayerControl } from '../../lib/layers';

globalThis.createImageBitmap = () => Promise.reject(new Error('Broken sprite.'));

const RAMPED: LayerControl = { id: 'elevation', title: 'Groundwater Elevation', visible: true, opacity: 1, colorRamp: 'viridis', colorRampRange: [-184.48, 607.27] };

describe('ogm-legend without a color ramp sprite', () => {
  it('still labels the range, just without a gradient', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { root } = await render(<ogm-legend layers={[RAMPED]}></ogm-legend>);
    const shadowRoot = root.shadowRoot as ShadowRoot;

    expect(shadowRoot.querySelector<HTMLElement>('.bar')?.style.background).toEqual('');
    expect(shadowRoot.querySelector('.min')?.textContent).toEqual('-184');
    expect(shadowRoot.querySelector('.max')?.textContent).toEqual('607');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('color ramp sprite'), expect.any(Error));
  });
});
