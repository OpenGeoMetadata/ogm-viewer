import { render, describe, it, expect, vi, h } from '@stencil/vitest';

import type { LayerControl } from '../../lib/layers';

// A legend rendered with no color ramp sprite behind it, which in a browser means one that failed
// to decode - see the catch in ogm-legend.tsx's componentWillLoad. A file of its own because the
// decoded sprite is memoized per module realm (see colormapSprite in src/lib/colormap.ts): once one
// test in a file has decoded it, no later one can un-decode it, so breaking it has to happen before
// anything renders. Everything else about the legend is in ogm-legend.test.tsx, where the sprite
// decodes normally.
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
    // Not silently: a legend that has quietly stopped explaining its colors is worth a line in the
    // console, and the spy is what keeps that line out of the test output.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('color ramp sprite'), expect.any(Error));
  });
});
