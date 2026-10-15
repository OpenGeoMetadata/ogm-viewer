import { MapLibreOverlay as DeckOverlay } from '@deck.gl/maplibre';
import type { Device } from '@luma.gl/core';
import type { MapLibreMap } from 'maplibre-gl';

/**
 * The overlay every deck.gl preview on a map draws into - a COG, the sheets of an index map - made the
 * first time one asks for it. MapLibre offers no way to ask what controls it already has, so this
 * reads the private list rather than adding a second overlay.
 *
 * Drawn interleaved, into MapLibre's own WebGL context, so a preview can be drawn under the basemap's
 * labels; and kept the size of that context's canvas after every resize, which deck.gl doesn't manage
 * for a canvas it didn't make itself - see syncFramebuffer.
 */
export function deckOverlay(map: MapLibreMap): DeckOverlay {
  const existing = map._controls.find(control => control instanceof DeckOverlay);
  if (existing) return existing;

  const overlay = new DeckOverlay({ interleaved: true });
  map.addControl(overlay);
  map.on('resize', () => syncFramebuffer(overlay, map));
  return overlay;
}

/**
 * Tell luma.gl the map's canvas has changed size, after MapLibre has resized it - entering fullscreen,
 * say, or a window resized.
 *
 * deck.gl sets the viewport it draws into from the size of luma.gl's default framebuffer, which luma.gl
 * only updates when it resizes the canvas itself. Here it never does: MapLibre owns the canvas and has
 * resized it already, and luma.gl, seeing the canvas the size it was asked for, skips the update. So
 * the framebuffer kept the canvas's old size, and deck.gl went on drawing into a box that size anchored
 * at the bottom left - shifted from the basemap, at the wrong scale, and sliding against it when panned.
 *
 * Remove this when luma.gl resizes the default framebuffer of a canvas someone else resized.
 */
export function syncFramebuffer(overlay: DeckOverlay, map: MapLibreMap) {
  // Not created until the overlay is added and its device is ready; nothing has been drawn before then
  const context = (overlay as unknown as { _deck?: { device?: Device } })._deck?.device?.canvasContext;
  if (!context) return;

  const { width, height } = map.getCanvas();
  context.setDrawingBufferSize(width, height);

  const framebuffer = context.getCurrentFramebuffer();
  if (framebuffer.width !== width || framebuffer.height !== height) framebuffer.resize([width, height]);
}
