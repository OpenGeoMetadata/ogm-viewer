/** @vitest-environment happy-dom */
import { describe, it, expect, vi } from 'vitest';
import type { Map } from 'maplibre-gl';

import LayersControl from './layers-control';

// onAdd only ever receives the map so a control can bind to it; this one doesn't, so it never reads
// the argument and a stand-in is enough
const FAKE_MAP = {} as Map;

const addControl = (onToggle = () => {}) => {
  const control = new LayersControl(onToggle);
  return { control, container: control.onAdd(FAKE_MAP) };
};

describe('LayersControl', () => {
  // The button carries no styling of its own: every rule that makes it look like map chrome, in both
  // themes, selects these class names. Getting them wrong would leave an unstyled button on the map.
  it('builds the same DOM as MapLibre draws its own controls with', () => {
    const { container } = addControl();

    expect(container.className).toEqual('maplibregl-ctrl maplibregl-ctrl-group');

    const buttons = container.querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].className).toEqual('maplibregl-ctrl-layers');
    expect(buttons[0].type).toEqual('button');
    expect(buttons[0].querySelector('.maplibregl-ctrl-icon')).not.toBeNull();
  });

  it('asks for the panel to be toggled when pressed', () => {
    const onToggle = vi.fn();
    const { container } = addControl(onToggle);

    container.querySelector('button')?.click();
    container.querySelector('button')?.click();

    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  // The icon is a background image, so these attributes are the only name the button has
  it('names itself for what pressing it will do', () => {
    const { control, container } = addControl();
    const button = container.querySelector('button') as HTMLButtonElement;

    expect(button.getAttribute('aria-pressed')).toEqual('false');
    expect(button.getAttribute('aria-label')).toEqual('Show layers');
    expect(button.title).toEqual('Show layers');
    expect(button.classList.contains('pressed')).toBe(false);

    control.setPressed(true);

    expect(button.getAttribute('aria-pressed')).toEqual('true');
    expect(button.getAttribute('aria-label')).toEqual('Hide layers');
    expect(button.title).toEqual('Hide layers');
    expect(button.classList.contains('pressed')).toBe(true);
  });

  it('hides without leaving the control stack, so it returns to the same place', () => {
    const { control, container } = addControl();

    control.setHidden(true);
    expect(container.hidden).toBe(true);

    control.setHidden(false);
    expect(container.hidden).toBe(false);
  });

  it('detaches itself when removed from the map', () => {
    const { control, container } = addControl();
    document.body.appendChild(container);

    control.onRemove(FAKE_MAP);

    expect(container.parentNode).toBeNull();
  });
});
