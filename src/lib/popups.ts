import type { PaddingOptions } from 'maplibre-gl';

export type Box = Pick<DOMRectReadOnly, 'left' | 'top' | 'right' | 'bottom'>;

// Leave this much room between a popup and the edge of the map after panning it into view.
export const POPUP_MARGIN = 10;

// Leave a span alone if it fits; otherwise move it inside the margin, keeping the given side in view when it cannot fit whole.
const shift = (start: number, end: number, min: number, max: number, margin: number, keep: 'start' | 'end'): number => {
  if (start >= min && end <= max) return 0;
  const toStart = start - min - margin;
  const toEnd = end - max + margin;
  if (end - start > max - min - 2 * margin) return keep === 'start' ? toStart : toEnd;
  return start < min ? toStart : toEnd;
};

// [X, Y] offset to pan by in order to bring a popup fully into view
export const panIntoView = (popup: Box, map: Box, covered: Partial<PaddingOptions> = {}, margin: number = POPUP_MARGIN): [number, number] => [
  shift(popup.left, popup.right, map.left + (covered.left ?? 0), map.right - (covered.right ?? 0), margin, 'end'),
  shift(popup.top, popup.bottom, map.top + (covered.top ?? 0), map.bottom - (covered.bottom ?? 0), margin, 'start'),
];
