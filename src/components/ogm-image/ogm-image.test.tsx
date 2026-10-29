import { describe, it, expect, h, vi, beforeEach, afterEach } from '@stencil/vitest';

import { render as stencilRender } from '@stencil/core';

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
const toggleFullscreen = (el: HTMLElement) => (el as unknown as { toggleFullscreen: () => Promise<void> }).toggleFullscreen();

const setThemeProperty = (el: HTMLElement, property: string, value: string) => {
  const scope = (el.shadowRoot as ShadowRoot).querySelector('#openseadragon') as HTMLElement;
  scope.style.setProperty(property, value);
};

describe('ogm-image', () => {
  it('keeps the theme’s gap on every edge of a scan', async () => {
    const { el } = await renderImage();
    setThemeProperty(el, '--ogm-padding', '50');
    Object.assign(el, { viewer: fakeViewer() });

    await applyPadding(el);

    expect(marginsOf(el)).toHaveBeenCalledWith({ top: 50, bottom: 50, right: 50, left: 50 });
  });

  it('adds what the sidebar covers to the gap on the left', async () => {
    const { el } = await renderImage();
    setThemeProperty(el, '--ogm-padding', '50');
    Object.assign(el, { viewer: fakeViewer(), padding: 400 });

    await applyPadding(el);

    expect(marginsOf(el)).toHaveBeenCalledWith({ top: 50, bottom: 50, right: 50, left: 450 });
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
