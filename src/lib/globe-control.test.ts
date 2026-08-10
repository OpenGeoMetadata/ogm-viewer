/** @vitest-environment happy-dom */
import { describe, it, expect } from 'vitest';
import type { Map } from 'maplibre-gl';

import GlobeControl from './globe-control';

// Unlike LayersControl, this one delegates to MapLibre's own control, which reads the projection it
// should show off the map, asks it for the strings to label itself with, and binds to the events that
// keep the icon in step when something else changes projection. A stand-in has to answer all of them.
const FAKE_MAP = {
  getProjection: () => ({ type: 'globe' }),
  _getUIString: (key: string) => key,
  on: () => {},
  off: () => {},
} as unknown as Map;

const addControl = () => {
  const control = new GlobeControl();
  return { control, container: control.onAdd(FAKE_MAP) };
};

describe('GlobeControl', () => {
  // Everything visible is MapLibre's; this only checks its work was passed through rather than
  // replaced, since a subclass that forgot to return super's element would leave nothing on the map
  it("hands back MapLibre's own globe button", () => {
    const { container } = addControl();

    expect(container.className).toEqual('maplibregl-ctrl maplibregl-ctrl-group');

    const buttons = container.querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].className).toContain('maplibregl-ctrl-globe');
  });

  it('hides without leaving the control stack, so it returns to the same place', () => {
    const { control, container } = addControl();
    document.body.appendChild(container);

    control.setHidden(true);

    expect(container.hidden).toBe(true);
    expect(container.parentNode).toEqual(document.body);

    control.setHidden(false);

    expect(container.hidden).toBe(false);
  });

  // Nothing calls it before the map has its controls, but a control that isn't on a map has no
  // element to hide and shouldn't throw looking for one
  it('does nothing when asked to hide before it has been added to a map', () => {
    expect(() => new GlobeControl().setHidden(true)).not.toThrow();
  });
});
