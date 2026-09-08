import { render, describe, it, expect, vi, h } from '@stencil/vitest';

import type { LayerControl } from '../../lib/layers';

// A ramp picker rendered with no color ramp sprite behind it, which in a browser means one that
// failed to decode - see the catch in ogm-layers.tsx's componentWillLoad. A file of its own because
// the decoded sprite is memoized per module realm (see colormapSprite in src/lib/colormap.ts): once
// one test in a file has decoded it, no later one can un-decode it, so breaking it has to happen
// before anything renders. Everything else about the panel is in ogm-layers.test.tsx, where the
// sprite decodes normally.
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
    // Still fully working as a picker, sprite or no sprite
    expect(shadowRoot.querySelector<HTMLInputElement>('.swatch input[value="viridis"]')?.checked).toBe(true);
    // Not silently: the spy is also what keeps the warning out of the test output
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('color ramp sprite'), expect.any(Error));
  });
});
