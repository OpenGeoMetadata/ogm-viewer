/** @vitest-environment happy-dom */
import { describe, it, expect } from 'vitest';
import type { Map } from 'maplibre-gl';

import GlobeControl from './globe-control';

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

  it('does nothing when asked to hide before it has been added to a map', () => {
    expect(() => new GlobeControl().setHidden(true)).not.toThrow();
  });
});
