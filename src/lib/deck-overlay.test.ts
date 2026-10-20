import { describe, it, expect, vi } from '@stencil/vitest';
import type { MapLibreMap } from 'maplibre-gl';

import { deckOverlay } from './deck-overlay';

// Enough of a MapLibre map to hold controls, fire events, and say how big its canvas now is. Its
// addControl never calls the control's onAdd, so deck.gl itself is never started.
class FakeMap {
  _controls: unknown[] = [];
  canvas = { width: 1600, height: 812 };
  listeners = new Map<string, Set<() => void>>();

  addControl(control: unknown) {
    this._controls.push(control);
  }
  getCanvas() {
    return this.canvas;
  }
  on(event: string, fn: () => void) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
  }
  emit(event: string) {
    this.listeners.get(event)?.forEach(fn => fn());
  }
}

// luma.gl's canvas context, as far as the overlay asks of it: a drawing buffer it can be told the size
// of, and the default framebuffer, which deck.gl takes the size of the viewport it draws into from
const fakeContext = (width: number, height: number) => {
  const framebuffer = {
    width,
    height,
    resize: vi.fn(function (this: { width: number; height: number }, [w, h]: [number, number]) {
      this.width = w;
      this.height = h;
    }),
  };
  return { framebuffer, setDrawingBufferSize: vi.fn(), getCurrentFramebuffer: () => framebuffer };
};

// The overlay with a device of its own, as deck.gl gives it one once it has been added to the map
const withContext = (overlay: unknown, context: ReturnType<typeof fakeContext>) => {
  Object.assign(overlay as object, { _deck: { device: { canvasContext: context } } });
};

describe('deckOverlay', () => {
  it('adds one overlay to a map, and hands the same one to every preview that asks', () => {
    const map = new FakeMap();

    const first = deckOverlay(map as unknown as MapLibreMap);
    const second = deckOverlay(map as unknown as MapLibreMap);

    expect(second).toBe(first);
    expect(map._controls).toEqual([first]);
    expect(map.listeners.get('resize')?.size).toEqual(1);
  });

  // Fullscreen, or a window resized: MapLibre has resized its canvas, and luma.gl's framebuffer has
  // kept the old size, so deck.gl would draw into a box that size at the bottom left
  it('resizes luma.gl’s framebuffer to the canvas once MapLibre has resized it', () => {
    const map = new FakeMap();
    const context = fakeContext(1600, 812);
    withContext(deckOverlay(map as unknown as MapLibreMap), context);

    map.canvas = { width: 1240, height: 1092 };
    map.emit('resize');

    expect(context.setDrawingBufferSize).toHaveBeenCalledWith(1240, 1092);
    expect(context.framebuffer.resize).toHaveBeenCalledWith([1240, 1092]);
    expect([context.framebuffer.width, context.framebuffer.height]).toEqual([1240, 1092]);
  });

  it('leaves a framebuffer that is already the canvas’s size alone', () => {
    const map = new FakeMap();
    const context = fakeContext(1600, 812);
    withContext(deckOverlay(map as unknown as MapLibreMap), context);

    map.emit('resize');

    expect(context.framebuffer.resize).not.toHaveBeenCalled();
  });

  // Nothing has been drawn yet, so there's nothing drawn at the wrong size
  it('does nothing before deck.gl has a device', () => {
    const map = new FakeMap();
    deckOverlay(map as unknown as MapLibreMap);

    map.canvas = { width: 1240, height: 1092 };

    expect(() => map.emit('resize')).not.toThrow();
  });
});
