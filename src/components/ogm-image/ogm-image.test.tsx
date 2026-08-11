import { describe, it, expect, h, vi, beforeEach, afterEach } from '@stencil/vitest';

// Rendered with Stencil's low-level render for the same reason <ogm-map>'s tests are: componentDidLoad
// throws here, since OpenSeadragon can't build a viewer without a canvas to draw on, and the wrapper
// would re-throw it. What's left is a mounted component with no viewer of its own, which is the state
// an <ogm-image> is in for real until componentDidLoad has run.
import { render as stencilRender } from '@stencil/core';

// Enough of an OpenSeadragon viewer to set the room around a scan on, and to be taken down afterwards
const fakeViewer = () => ({ viewport: { setMargins: vi.fn() }, destroy: vi.fn() });

const containers: HTMLElement[] = [];
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  containers.splice(0).forEach(container => container.remove());
  consoleError.mockRestore();
});

const renderImage = async () => {
  const container = document.createElement('div');
  containers.push(container);
  document.body.appendChild(container);
  await stencilRender(<ogm-image></ogm-image>, container);
  const el = container.firstElementChild as HTMLElement & { componentOnReady?: () => Promise<unknown> };
  await el.componentOnReady?.();
  consoleError.mockClear();
  return { container, el };
};

const marginsOf = (el: HTMLElement) => (el as unknown as { viewer: ReturnType<typeof fakeViewer> }).viewer.viewport.setMargins;
const applyPadding = (el: HTMLElement) => (el as unknown as { onPaddingChange: () => Promise<void> }).onPaddingChange();

describe('ogm-image', () => {
  // Left to itself OpenSeadragon fits a scan flush against the edges of the viewer, so the edges of
  // the sheet - which is often what a reader is looking for - are the first thing lost
  it('keeps the theme’s gap on every edge of a scan', async () => {
    const { el } = await renderImage();
    el.style.setProperty('--ogm-padding', '50');
    Object.assign(el, { viewer: fakeViewer() });

    await applyPadding(el);

    expect(marginsOf(el)).toHaveBeenCalledWith({ top: 50, bottom: 50, right: 50, left: 50 });
  });

  // OpenSeadragon replaces the whole set of margins with whatever it's handed, so the left edge has to
  // carry both the gap and the sidebar rather than the sidebar alone
  it('adds what the sidebar covers to the gap on the left', async () => {
    const { el } = await renderImage();
    el.style.setProperty('--ogm-padding', '50');
    Object.assign(el, { viewer: fakeViewer(), padding: 400 });

    await applyPadding(el);

    expect(marginsOf(el)).toHaveBeenCalledWith({ top: 50, bottom: 50, right: 50, left: 450 });
  });
});
