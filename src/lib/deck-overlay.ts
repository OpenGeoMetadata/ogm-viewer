import { MapLibreOverlay as DeckOverlay } from '@deck.gl/maplibre';
import type { Device } from '@luma.gl/core';
import type { MapLibreMap } from 'maplibre-gl';

// Create and configure a shared deck.gl overlay for drawing into
export function deckOverlay(map: MapLibreMap): DeckOverlay {
  const existing = map._controls.find(control => control instanceof DeckOverlay);
  if (existing) return existing;

  const overlay = new DeckOverlay({ interleaved: true });
  map.addControl(overlay);
  map.on('resize', () => syncFramebuffer(overlay, map));
  return overlay;
}

// Force luma.gl to update its framebuffer size, e.g. when fullscreen is
// activated. Without this, deck.gl previews don't draw correctly.
export function syncFramebuffer(overlay: DeckOverlay, map: MapLibreMap) {
  // Not created until the overlay is added and its device is ready; nothing has been drawn before then
  const context = (overlay as unknown as { _deck?: { device?: Device } })._deck?.device?.canvasContext;
  if (!context) return;

  const { width, height } = map.getCanvas();
  context.setDrawingBufferSize(width, height);

  const framebuffer = context.getCurrentFramebuffer();
  if (framebuffer.width !== width || framebuffer.height !== height) framebuffer.resize([width, height]);
}
