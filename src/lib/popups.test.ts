import { describe, it, expect } from '@stencil/vitest';
import { panIntoView, type Box } from './popups';

const box = (left: number, top: number, width: number, height: number): Box => ({ left, top, right: left + width, bottom: top + height });

// Match the 800 × 405 preview the clipping was reported in, offset within the page.
const map = box(100, 300, 800, 405);

describe('panIntoView', () => {
  it('leaves a popup that already fits where it is', () => {
    expect(panIntoView(box(300, 400, 200, 250), map)).toEqual([0, 0]);
  });

  it('leaves a popup alone even when it sits inside the margin', () => {
    expect(panIntoView(box(103, 302, 200, 400), map)).toEqual([0, 0]);
  });

  it('pans a popup hanging off the bottom up by its overflow and the margin', () => {
    expect(panIntoView(box(300, 515, 186, 278), map)).toEqual([0, 98]);
  });

  it('pans a popup clipped at the top down', () => {
    expect(panIntoView(box(300, 280, 200, 100), map)).toEqual([0, -30]);
  });

  it('pans a popup clipped at the right to the left', () => {
    expect(panIntoView(box(500, 400, 402, 200), map)).toEqual([12, 0]);
  });

  it('pans a popup clipped at the left to the right', () => {
    expect(panIntoView(box(60, 400, 200, 200), map)).toEqual([-50, 0]);
  });

  it('keeps the top of a popup taller than the map in view', () => {
    expect(panIntoView(box(300, 480, 200, 500), map)).toEqual([0, 170]);
  });

  it('keeps the right of a popup wider than the map in view, where its close button is', () => {
    expect(panIntoView(box(50, 400, 900, 200), map)).toEqual([60, 0]);
  });

  it('keeps the close button of a popup only just too wide for the map clear of the edge', () => {
    expect(panIntoView(box(90, 400, 790, 200), map)).toEqual([-10, 0]);
  });

  it('treats padded edges of the map as covered', () => {
    expect(panIntoView(box(300, 400, 200, 200), map, { left: 400 })).toEqual([-210, 0]);
  });
});
