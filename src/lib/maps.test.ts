import { describe, it, expect, vi } from '@stencil/vitest';

import { fitBounds } from './maps';
import type Theme from './themes/theme';

const PADDING = 50;
const theme = { getPadding: () => PADDING } as Theme;

const BOUNDS: [[number, number], [number, number]] = [
  [-124.41, 32.53],
  [-114.13, 42.01],
];

// Enough of a MapLibre map to be pointed somewhere: it can work out a camera, it can be moved, and
// it reports the move as having finished, which is what fitBounds waits for before resolving.
const fittableMap = (cameraForBounds = vi.fn(() => ({ center: [0, 0], zoom: 4 }))) => ({
  cameraForBounds,
  fitBounds: vi.fn(),
  once: vi.fn((_event: string, listener: () => void) => listener()),
});

describe('fitBounds', () => {
  it('should wait for the map to finish moving', async () => {
    const map = fittableMap();
    await fitBounds(map as unknown as maplibregl.Map, theme, BOUNDS);

    expect(map.fitBounds).toHaveBeenCalledWith(BOUNDS, { padding: PADDING });
    expect(map.once).toHaveBeenCalledWith('moveend', expect.any(Function));
  });

  // So a record's own edges read as edges instead of running off the canvas
  it('should keep the theme’s gap between the bounds and the edge', async () => {
    const map = fittableMap();
    await fitBounds(map as unknown as maplibregl.Map, { getPadding: () => 8 } as Theme, BOUNDS);

    expect(map.fitBounds).toHaveBeenCalledWith(BOUNDS, { padding: 8 });
  });

  // What a caller wants of this one camera, as against the limits it set on the map itself: those
  // hold for every camera, including the ones a reader drives with a wheel. Asked of the solve as
  // well as of the move, so the two can't disagree about whether the bounds can be framed at all.
  it('should carry the caller’s own camera options into both the solve and the move', async () => {
    const map = fittableMap();
    await fitBounds(map as unknown as maplibregl.Map, theme, BOUNDS, { maxZoom: 12 });

    expect(map.cameraForBounds).toHaveBeenCalledWith(BOUNDS, { padding: PADDING, maxZoom: 12 });
    expect(map.fitBounds).toHaveBeenCalledWith(BOUNDS, { padding: PADDING, maxZoom: 12 });
  });

  it('should leave the camera alone when there is no camera that would frame the bounds', async () => {
    const map = fittableMap(vi.fn(() => undefined) as never);
    await fitBounds(map as unknown as maplibregl.Map, theme, BOUNDS);

    expect(map.fitBounds).not.toHaveBeenCalled();
  });

  // The same non-answer, arriving differently: on a globe MapLibre reads its own undefined and
  // throws, because the globe solve takes the flat camera and only corrects its zoom. Either way
  // there is nowhere to point, and neither is the preview's failure to report.
  it('should leave the camera alone when a globe throws over bounds it cannot frame', async () => {
    const map = fittableMap(
      vi.fn(() => {
        throw new TypeError("Cannot read properties of undefined (reading 'center')");
      }) as never,
    );

    await expect(fitBounds(map as unknown as maplibregl.Map, theme, BOUNDS)).resolves.toBeUndefined();
    expect(map.fitBounds).not.toHaveBeenCalled();
  });
});
