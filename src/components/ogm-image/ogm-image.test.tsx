import { describe, it, expect, h, vi, beforeEach, afterEach } from '@stencil/vitest';

// Rendered with Stencil's low-level render for the same reason <ogm-map>'s tests are: componentDidLoad
// throws here, since OpenSeadragon can't build a viewer without a canvas to draw on, and the wrapper
// would re-throw it. What's left is a mounted component with no viewer of its own, which is the state
// an <ogm-image> is in for real until componentDidLoad has run.
import { render as stencilRender } from '@stencil/core';

// Enough of an OpenSeadragon viewer to set the room around a scan on, and to be taken down afterwards
const fakeViewer = () => ({
  viewport: {
    setMargins: vi.fn(),
    imageToViewportRectangle: vi.fn((x, y, width, height) => ({ x, y, width, height })),
    fitBounds: vi.fn(),
  },
  world: { getItemCount: vi.fn(() => 1) },
  addOverlay: vi.fn(),
  removeOverlay: vi.fn(),
  destroy: vi.fn(),
});

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
const toggleFullscreen = (el: HTMLElement) => (el as unknown as { toggleFullscreen: () => Promise<void> }).toggleFullscreen();

// Set a property the theme reads, on the element it reads from - the scope inside the shadow root, not
// the host. Same reason Theme's own tests declare them on the element under test: happy-dom resolves a
// custom property set on that element but doesn't inherit one down the tree, and reaching in from the
// host - which is how an embedding page actually sets these - is inheritance doing its job.
const setThemeProperty = (el: HTMLElement, property: string, value: string) => {
  const scope = (el.shadowRoot as ShadowRoot).querySelector('#openseadragon') as HTMLElement;
  scope.style.setProperty(property, value);
};

describe('ogm-image', () => {
  // Left to itself OpenSeadragon fits a scan flush against the edges of the viewer, so the edges of
  // the sheet - which is often what a reader is looking for - are the first thing lost
  it('keeps the theme’s gap on every edge of a scan', async () => {
    const { el } = await renderImage();
    setThemeProperty(el, '--ogm-padding', '50');
    Object.assign(el, { viewer: fakeViewer() });

    await applyPadding(el);

    expect(marginsOf(el)).toHaveBeenCalledWith({ top: 50, bottom: 50, right: 50, left: 50 });
  });

  // OpenSeadragon replaces the whole set of margins with whatever it's handed, so the left edge has to
  // carry both the gap and the sidebar rather than the sidebar alone
  it('adds what the sidebar covers to the gap on the left', async () => {
    const { el } = await renderImage();
    setThemeProperty(el, '--ogm-padding', '50');
    Object.assign(el, { viewer: fakeViewer(), padding: 400 });

    await applyPadding(el);

    expect(marginsOf(el)).toHaveBeenCalledWith({ top: 50, bottom: 50, right: 50, left: 450 });
  });

  it('zooms to and highlights a Content Search pixel selector', async () => {
    const { el } = await renderImage();
    const viewer = fakeViewer();
    Object.assign(el, { viewer });

    const focused = await (
      el as HTMLElement & {
        focusAnnotation(annotation: unknown): Promise<boolean>;
      }
    ).focusAnnotation({
      type: 'Annotation',
      body: { type: 'TextualBody', value: 'Market St.' },
      target: {
        source: 'https://example.org/canvas/1',
        selector: { type: 'FragmentSelector', value: 'xywh=10,20,100,30' },
      },
    });

    expect(focused).toBe(true);
    expect(viewer.viewport.imageToViewportRectangle).toHaveBeenCalledWith(10, 20, 100, 30);
    expect(viewer.addOverlay).toHaveBeenCalledWith(
      expect.objectContaining({
        element: expect.objectContaining({ className: 'content-search-highlight' }),
        location: { x: 10, y: 20, width: 100, height: 30 },
      }),
    );
    expect(viewer.viewport.fitBounds).toHaveBeenCalledWith({ x: 10, y: 20, width: 100, height: 30 }, true);
  });

  it('fullscreens its containing viewer without asking OpenSeadragon to detach the image', async () => {
    const { el } = await renderImage();
    const target = document.createElement('ogm-viewer');
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    const exitFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(target, 'requestFullscreen', { configurable: true, value: requestFullscreen });
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exitFullscreen });
    Object.assign(el, { fullscreenTarget: () => target });

    await toggleFullscreen(el);

    expect(requestFullscreen).toHaveBeenCalledOnce();
    expect((el as unknown as { fullscreen: boolean }).fullscreen).toBe(true);

    await toggleFullscreen(el);
    expect(exitFullscreen).toHaveBeenCalledOnce();
    expect((el as unknown as { fullscreen: boolean }).fullscreen).toBe(false);
  });

  it('uses and exits an in-place fallback when native fullscreen is unavailable', async () => {
    const { el } = await renderImage();
    const target = document.createElement('ogm-viewer');
    Object.defineProperty(target, 'requestFullscreen', {
      configurable: true,
      value: vi.fn().mockRejectedValue(new Error('Fullscreen unavailable')),
    });
    Object.assign(el, { fullscreenTarget: () => target });

    await toggleFullscreen(el);
    expect((el as unknown as { fullscreenFallback: boolean }).fullscreenFallback).toBe(true);
    expect(target.hasAttribute('data-ogm-fullscreen-fallback')).toBe(true);

    await toggleFullscreen(el);
    expect((el as unknown as { fullscreenFallback: boolean }).fullscreenFallback).toBe(false);
    expect(target.hasAttribute('data-ogm-fullscreen-fallback')).toBe(false);
  });
});
