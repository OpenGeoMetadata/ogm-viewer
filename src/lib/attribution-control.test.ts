/** @vitest-environment happy-dom */
import { describe, it, expect } from 'vitest';
import type { Map } from 'maplibre-gl';

import AttributionControl from './attribution-control';

const fakeMap = () => {
  const listeners: Record<string, ((event: unknown) => void)[]> = {};

  return {
    listeners,
    style: { stylesheet: undefined as unknown, tileManagers: {} as Record<string, unknown> },
    getCanvasContainer: () => document.createElement('div'),
    _getUIString: (key: string) => key,
    on(event: string, listener: (event: unknown) => void) {
      (listeners[event] ??= []).push(listener);
    },
    off(event: string, listener: (event: unknown) => void) {
      listeners[event] = (listeners[event] ?? []).filter(bound => bound !== listener);
    },
    fire(event: string, data: unknown = {}) {
      [...(listeners[event] ?? [])].forEach(listener => listener(data));
    },
  };
};

const addControl = () => {
  const map = fakeMap();
  const control = new AttributionControl({ compact: true });
  const container = control.onAdd(map as unknown as Map) as HTMLDetailsElement;
  document.body.appendChild(container);
  return { map, control, container, button: container.querySelector('summary') as HTMLElement };
};

const credit = (map: ReturnType<typeof fakeMap>) => {
  map.style.stylesheet = {};
  map.style.tileManagers = { basemap: { used: true, getSource: () => ({ attribution: '© CARTO' }) } };
  map.fire('sourcedata', { dataType: 'source', sourceDataType: 'metadata' });
};

const shown = (container: HTMLElement) => container.classList.contains('maplibregl-compact-show');

describe('AttributionControl', () => {
  it("hands back MapLibre's own attribution", () => {
    const { container, button } = addControl();

    expect(container.tagName).toEqual('DETAILS');
    expect(container.className).toContain('maplibregl-ctrl-attrib');
    expect(button.className).toContain('maplibregl-ctrl-attrib-button');
    expect(button.getAttribute('aria-label')).toBeTruthy();
  });

  it('credits nothing until there is something to credit', () => {
    const { container } = addControl();

    expect(container.classList.contains('maplibregl-attrib-empty')).toBe(true);
  });

  it('starts as the "i" rather than as the open panel', () => {
    const { map, container } = addControl();
    credit(map);

    expect(container.classList.contains('maplibregl-compact')).toBe(true);
    expect(shown(container)).toBe(false);
    expect(container.textContent).toContain('CARTO');
  });

  it('opens when the reader asks, and closes again', () => {
    const { map, container, button } = addControl();
    credit(map);

    button.click();
    expect(shown(container)).toBe(true);

    button.click();
    expect(shown(container)).toBe(false);
  });

  it('stays closed when the map is resized', () => {
    const { map, container } = addControl();
    credit(map);

    map.fire('resize');

    expect(shown(container)).toBe(false);
  });

  it('leaves a panel the reader opened open', () => {
    const { map, container, button } = addControl();
    credit(map);
    button.click();

    map.fire('resize');
    map.fire('styledata', { dataType: 'style' });

    expect(shown(container)).toBe(true);
  });
});
