/** @vitest-environment happy-dom */
import { describe, it, expect, vi } from 'vitest';
import type { Map } from 'maplibre-gl';

import GeosearchControl from './geosearch-control';

const HELP = 'Shift + drag to search an area';

const fakeMap = () => {
  const listeners: Record<string, ((event: unknown) => void)[]> = {};
  return {
    on: vi.fn((type: string, listener: (event: unknown) => void) => {
      (listeners[type] ??= []).push(listener);
    }),
    off: vi.fn((type: string, listener: (event: unknown) => void) => {
      listeners[type] = (listeners[type] ?? []).filter(bound => bound !== listener);
    }),
    fire: (type: string, event: unknown = {}) => [...(listeners[type] ?? [])].forEach(listener => listener(event)),
    bound: (type: string) => (listeners[type] ?? []).length,
  };
};

const addControl = (text = HELP) => {
  const map = fakeMap();
  const control = new GeosearchControl(text);
  const container = control.onAdd(map as unknown as Map);
  document.body.appendChild(container);

  return { control, container, map };
};

describe('GeosearchControl', () => {
  it('should build the DOM its styling selects', () => {
    const { container } = addControl();

    expect(container.className).toEqual('maplibregl-ctrl maplibregl-ctrl-geosearch');
    expect(container.children).toHaveLength(0);
  });

  it('should say how to search, in the words it was given', () => {
    expect(addControl('Cerca arrossegant amb la tecla de majúscules').container.textContent).toEqual('Cerca arrossegant amb la tecla de majúscules');
  });

  it('should be retexted where it stands', () => {
    const { control, container } = addControl();
    control.setText('Search by dragging');

    expect(container.textContent).toEqual('Search by dragging');
    expect(container.parentNode).toEqual(document.body);
  });

  it('should get out of the way while a box is being drawn, and come back', () => {
    const { container, map } = addControl();

    map.fire('boxzoomstart');
    expect(container.hidden).toBe(true);

    map.fire('boxzoomend');
    expect(container.hidden).toBe(false);
  });

  it('should come back from a box the reader gave up on', () => {
    const { container, map } = addControl();

    map.fire('boxzoomstart');
    map.fire('boxzoomcancel');

    expect(container.hidden).toBe(false);
  });

  it('should come back when the reader walks away partway through a box', () => {
    const { container, map } = addControl();

    map.fire('boxzoomstart');
    window.dispatchEvent(new Event('blur'));

    expect(container.hidden).toBe(false);
  });

  it('should let go of the map when removed', () => {
    const { control, container, map } = addControl();
    control.onRemove(map as unknown as Map);

    expect(map.bound('boxzoomstart')).toEqual(0);
    expect(map.bound('boxzoomend')).toEqual(0);
    expect(map.bound('boxzoomcancel')).toEqual(0);
    expect(container.parentNode).toBeNull();

    container.hidden = true;
    window.dispatchEvent(new Event('blur'));
    expect(container.hidden).toBe(true);
  });

  it('should do nothing when retexted before it has been added to a map', () => {
    expect(() => new GeosearchControl(HELP).setText('Search here')).not.toThrow();
  });
});
