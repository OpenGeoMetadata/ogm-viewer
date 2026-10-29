import { MapLibreOverlay as DeckOverlay } from '@deck.gl/maplibre';
import type { Device } from '@luma.gl/core';
import type { MapLibreMap } from 'maplibre-gl';

export function deckOverlay(map: MapLibreMap): DeckOverlay {
  const existing = map._controls.find(control => control instanceof DeckOverlay);
  if (existing) return existing;

  const overlay = new DeckOverlay({ interleaved: true });
  map.addControl(overlay);
  map.on('resize', () => syncFramebuffer(overlay, map));
  return overlay;
}

export function syncFramebuffer(overlay: DeckOverlay, map: MapLibreMap) {
  const context = (overlay as unknown as { _deck?: { device?: Device } })._deck?.device?.canvasContext;
  if (!context) return;

  const { width, height } = map.getCanvas();
  context.setDrawingBufferSize(width, height);

  const framebuffer = context.getCurrentFramebuffer();
  if (framebuffer.width !== width || framebuffer.height !== height) framebuffer.resize([width, height]);
}
