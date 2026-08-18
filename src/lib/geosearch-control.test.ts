/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Map } from 'maplibre-gl';

import GeosearchControl, { type GeosearchMode } from './geosearch-control';

const LABELS = { searchHere: 'Search here', searchOnMove: 'Search when I move the map' };

// Enough of a map to bind to and to fire at. The control reads nothing off it - the bounds are the
// component's to fetch once the callback comes - so a stand-in only has to remember what was bound.
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

// The reader's own hand on the camera, and something else pointing it; see handleCameraEnd
const DROVE = { originalEvent: new MouseEvent('mouseup') };
const POINTED = {};

const addControl = (mode: GeosearchMode = 'auto') => {
  const onSearch = vi.fn();
  const map = fakeMap();
  const control = new GeosearchControl(onSearch, LABELS, mode);
  const container = control.onAdd(map as unknown as Map);

  // On the page, so the focus a mode swap follows has somewhere to be
  document.body.appendChild(container);

  return {
    control,
    container,
    map,
    onSearch,
    label: container.querySelector('label') as HTMLLabelElement,
    checkbox: container.querySelector('input') as HTMLInputElement,
    button: container.querySelector('button') as HTMLButtonElement,
  };
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('GeosearchControl', () => {
  // The control carries no styling of its own: every rule that makes it look like map chrome, in both
  // themes, selects these class names. It stays out of maplibregl-ctrl-group on purpose - see onAdd.
  it('builds the DOM its styling selects', () => {
    const { container, label, checkbox, button } = addControl();

    expect(container.className).toEqual('maplibregl-ctrl maplibregl-ctrl-geosearch');
    expect(container.classList.contains('maplibregl-ctrl-group')).toBe(false);
    expect(label.className).toEqual('on-move');
    expect(checkbox.type).toEqual('checkbox');
    expect(button.className).toEqual('search-here');
    expect(button.type).toEqual('button');
  });

  // The words are the checkbox's accessible name, so there is no aria-label to check against them
  it('says what it will do in whichever mode it is in', () => {
    const { label, checkbox, button } = addControl();

    expect(label.hidden).toBe(false);
    expect(checkbox.checked).toBe(true);
    expect(label.textContent).toEqual('Search when I move the map');
    expect(button.hidden).toBe(true);
    expect(button.textContent).toEqual('Search here');
  });

  it('opens ready to be asked, when that is the mode it was built for', () => {
    const { label, checkbox, button } = addControl('manual');

    expect(button.hidden).toBe(false);
    expect(label.hidden).toBe(true);
    expect(checkbox.checked).toBe(false);
  });

  it('takes its wording from what it was given, and is retexted where it stands', () => {
    const { control, label, button } = addControl();

    control.setLabels({ searchHere: 'Cerca aquí', searchOnMove: 'Cerca quan moc el mapa' });

    expect(label.textContent).toEqual('Cerca quan moc el mapa');
    expect(button.textContent).toEqual('Cerca aquí');
  });

  it('asks for a search once the map has been left alone', () => {
    const { map, onSearch } = addControl();

    map.fire('moveend', DROVE);
    vi.advanceTimersByTime(799);
    expect(onSearch).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onSearch).toHaveBeenCalledTimes(1);
  });

  it('asks about where the reader stopped rather than everywhere they passed through', () => {
    const { map, onSearch } = addControl();

    map.fire('moveend', DROVE);
    vi.advanceTimersByTime(400);
    map.fire('moveend', DROVE);
    vi.advanceTimersByTime(400);
    map.fire('moveend', DROVE);
    vi.advanceTimersByTime(800);

    expect(onSearch).toHaveBeenCalledTimes(1);
  });

  // The case the originalEvent guard is for: trackContainerSize's map.resize() fires moveend on every
  // reflow, and draw()'s fitBounds fires one on every record change. Neither is the reader asking.
  it('says nothing about a camera it did not drive', () => {
    const { map, onSearch } = addControl();

    map.fire('moveend', POINTED);
    vi.advanceTimersByTime(800);

    expect(onSearch).not.toHaveBeenCalled();
  });

  // A container that resizes mid-drag calls Camera#stop, which fires dragend and swallows the moveend
  it('asks for a search after a drag whose moveend went missing', () => {
    const { map, onSearch } = addControl();

    map.fire('dragend', DROVE);
    vi.advanceTimersByTime(800);

    expect(onSearch).toHaveBeenCalledTimes(1);
  });

  // A box zoom's camera is a fitScreenCoordinates call with no event data, so only the boxzoomend just
  // before it says a shift-drag happened at all
  it('asks for one search after a box zoom, whose own moveend arrives untagged', () => {
    const { map, onSearch } = addControl();

    map.fire('boxzoomend', DROVE);
    map.fire('moveend', POINTED);
    vi.advanceTimersByTime(800);

    expect(onSearch).toHaveBeenCalledTimes(1);
  });

  it('searches nothing in manual mode, however far the map is moved', () => {
    const { map, onSearch } = addControl('manual');

    map.fire('moveend', DROVE);
    vi.advanceTimersByTime(800);

    expect(onSearch).not.toHaveBeenCalled();
  });

  it('offers to search here instead, as soon as the reader stops wanting it done for them', () => {
    const { checkbox, label, button } = addControl();

    checkbox.click();

    expect(checkbox.checked).toBe(false);
    expect(label.hidden).toBe(true);
    expect(button.hidden).toBe(false);
  });

  it('drops a search the reader has just called off', () => {
    const { map, checkbox, onSearch } = addControl();

    map.fire('moveend', DROVE);
    vi.advanceTimersByTime(400);
    checkbox.click();
    vi.advanceTimersByTime(800);

    expect(onSearch).not.toHaveBeenCalled();
  });

  it('searches at once when asked outright, then goes back to searching every view', () => {
    const { map, checkbox, label, button, onSearch } = addControl('manual');

    button.click();

    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(checkbox.checked).toBe(true);
    expect(label.hidden).toBe(false);
    expect(button.hidden).toBe(true);

    map.fire('moveend', DROVE);
    vi.advanceTimersByTime(800);
    expect(onSearch).toHaveBeenCalledTimes(2);
  });

  // Hiding what holds focus drops it to the body, so it is handed to whatever took its place. That move
  // is also what announces the mode change, which is why nothing here says it out loud.
  it('hands focus to whichever of the two it just showed', () => {
    const { checkbox, button } = addControl();

    checkbox.focus();
    checkbox.click();
    expect(document.activeElement).toEqual(button);

    button.click();
    expect(document.activeElement).toEqual(checkbox);
  });

  it('leaves focus alone when the reader was somewhere else entirely', () => {
    const { checkbox, button } = addControl();
    const elsewhere = document.createElement('input');
    document.body.appendChild(elsewhere);
    elsewhere.focus();

    checkbox.click();

    expect(document.activeElement).toEqual(elsewhere);
    expect(button.hidden).toBe(false);
  });

  it('lets go of the map when removed, and of the search it was about to ask for', () => {
    const { control, container, map, onSearch } = addControl();

    map.fire('moveend', DROVE);
    control.onRemove(map as unknown as Map);
    vi.advanceTimersByTime(800);

    expect(onSearch).not.toHaveBeenCalled();
    expect(map.bound('moveend')).toEqual(0);
    expect(map.bound('dragend')).toEqual(0);
    expect(map.bound('boxzoomend')).toEqual(0);
    expect(container.parentNode).toBeNull();
  });

  // Nothing calls it before the map has its controls, but a control that isn't on a map has nothing to
  // retext and shouldn't throw looking for it
  it('does nothing when retexted before it has been added to a map', () => {
    expect(() => new GeosearchControl(vi.fn(), LABELS).setLabels(LABELS)).not.toThrow();
  });
});
