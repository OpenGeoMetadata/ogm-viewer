import { render, describe, it, expect, h, vi } from '@stencil/vitest';

import { getElement } from '../../lib/elements';
import type { LayerControl } from '../../lib/layers';
import TimeDomain from '../../lib/time';

// MODIS true color, daily, with a gap between its runs - as GIBS lists it, cut down
const DAILY = TimeDomain.parse(['2000-02-24/2000-04-25/P1D', '2000-04-28/2000-08-06/P1D', '2025-11-10/2026-10-03/P1D']);

// GOES-East GeoColor, every ten minutes
const GOES = TimeDomain.parse(['2026-08-10T16:30:00Z/2026-08-10T17:30:00Z/PT10M', '2026-09-30T02:40:00Z/2026-10-02T23:30:00Z/PT10M']);

const item = (id: string, title: string, overrides: Partial<LayerControl> = {}): LayerControl => ({ id, title, visible: true, opacity: 1, ...overrides });

const MODIS = item('modis', 'Corrected Reflectance (True Color)', { time: '2026-10-01', timeDomain: DAILY });
const GEOCOLOR = item('goes', 'GeoColor', { time: '2026-10-02T18:50:00Z', timeDomain: GOES });

type TimeChange = { id: string; time: string };

const renderTime = async (layers: LayerControl[]) => {
  const rendered = await render(<ogm-time layers={layers}></ogm-time>);
  const changes: TimeChange[] = [];
  const requests: string[] = [];
  rendered.root.addEventListener('layerTimeChange', (event: Event) => changes.push((event as CustomEvent<TimeChange>).detail));
  rendered.root.addEventListener('layerTimeDomainRequest', (event: Event) => requests.push((event as CustomEvent<{ id: string }>).detail.id));
  return { ...rendered, shadowRoot: rendered.root.shadowRoot as ShadowRoot, changes, requests };
};

const label = (shadowRoot: ShadowRoot) => shadowRoot.querySelector('.value .label')?.textContent;

// Longer than the date field is given to settle before what it holds is acted on
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 700));

const click = (root: HTMLElement, selector: string) => (getElement(root, selector) as HTMLButtonElement).click();

// What a date field does as the reader picks or finishes typing a date
const typeDate = (root: HTMLElement, value: string) => {
  const field = getElement(root, '.date') as HTMLInputElement;
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('ogm-time', () => {
  it('shows nothing for layers with no time to choose', async () => {
    const { shadowRoot } = await renderTime([item('districts', 'Districts')]);
    expect(shadowRoot.querySelector('.panel')).toBeNull();
  });

  it('shows nothing for a layer published at a single time', async () => {
    const { shadowRoot } = await renderTime([item('gedi', 'Biomass', { time: '2019-04-18', timeDomain: TimeDomain.parse(['2019-04-18/2019-04-18/P1429D']) })]);
    expect(shadowRoot.querySelector('.panel')).toBeNull();
  });

  it('shows the time being drawn', async () => {
    const { shadowRoot } = await renderTime([MODIS]);

    expect(label(shadowRoot)).toEqual('Oct 1, 2026');
    expect(shadowRoot.querySelector('.panel')?.getAttribute('aria-label')).toEqual('Time');
  });

  it('shows a sub-daily layer’s time of day, in UTC', async () => {
    const { shadowRoot } = await renderTime([GEOCOLOR]);
    expect(label(shadowRoot)).toEqual('Oct 2, 2026, 18:50 UTC');
  });

  it('steps back and forth through the times the layer offers', async () => {
    const { root, changes } = await renderTime([MODIS]);

    click(root, '.previous');
    click(root, '.next');

    expect(changes).toEqual([
      { id: 'modis', time: '2026-09-30' },
      { id: 'modis', time: '2026-10-02' },
    ]);
  });

  it('steps over a gap between the times', async () => {
    const { root, changes } = await renderTime([item('modis', 'MODIS', { time: '2000-04-28', timeDomain: DAILY })]);

    click(root, '.previous');

    expect(changes).toEqual([{ id: 'modis', time: '2000-04-25' }]);
  });

  it('steps ten minutes at a time through a sub-daily layer, writing whole timestamps', async () => {
    const { root, changes } = await renderTime([GEOCOLOR]);

    click(root, '.previous');

    expect(changes).toEqual([{ id: 'goes', time: '2026-10-02T18:40:00Z' }]);
  });

  it('names where each step goes', async () => {
    const { shadowRoot } = await renderTime([MODIS]);

    expect(shadowRoot.querySelector('.previous')?.getAttribute('aria-label')).toEqual('Previous: Sep 30, 2026');
    expect(shadowRoot.querySelector('.next')?.getAttribute('aria-label')).toEqual('Next: Oct 2, 2026');
  });

  it('can’t step past the first time or the last', async () => {
    const first = await renderTime([item('modis', 'MODIS', { time: '2000-02-24', timeDomain: DAILY })]);
    const last = await renderTime([item('modis', 'MODIS', { time: '2026-10-03', timeDomain: DAILY })]);

    expect(first.shadowRoot.querySelector<HTMLButtonElement>('.previous')?.disabled).toBe(true);
    expect(first.shadowRoot.querySelector<HTMLButtonElement>('.next')?.disabled).toBe(false);
    expect(last.shadowRoot.querySelector<HTMLButtonElement>('.next')?.disabled).toBe(true);
  });

  it('says the time being drawn for a reader who can’t see it change', async () => {
    const { shadowRoot } = await renderTime([MODIS]);

    const status = shadowRoot.querySelector('.status');
    expect(status?.getAttribute('role')).toEqual('status');
    expect(status?.textContent).toEqual('Showing Oct 1, 2026');
  });

  describe('unfolded', () => {
    const unfold = async (layers: LayerControl[]) => {
      const rendered = await renderTime(layers);
      click(rendered.root, '.value');
      await rendered.waitForChanges();
      return rendered;
    };

    it('starts folded away', async () => {
      const { shadowRoot } = await renderTime([MODIS]);

      expect(shadowRoot.querySelector('.picker')).toBeNull();
      expect(shadowRoot.querySelector('.value')?.getAttribute('aria-expanded')).toEqual('false');
    });

    it('offers a date field that reaches only as far as the layer’s times do', async () => {
      const { shadowRoot } = await unfold([MODIS]);
      const field = shadowRoot.querySelector<HTMLInputElement>('.date');

      expect(shadowRoot.querySelector('.value')?.getAttribute('aria-expanded')).toEqual('true');
      expect(field?.value).toEqual('2026-10-01');
      expect(field?.min).toEqual('2000-02-24');
      expect(field?.max).toEqual('2026-10-03');
      expect(shadowRoot.querySelector('.range')?.textContent).toEqual('Data covers Feb 24, 2000 to Oct 3, 2026');
    });

    it('draws the day picked', async () => {
      const { root, changes } = await unfold([MODIS]);

      typeDate(root, '2026-03-01');

      await vi.waitFor(() => expect(changes).toEqual([{ id: 'modis', time: '2026-03-01' }]));
    });

    // Typed segment by segment, a date is a whole one after each: the month first, then the day
    it('draws only the date the field settles on', async () => {
      const { root, changes } = await unfold([MODIS]);

      typeDate(root, '2026-03-29');
      typeDate(root, '2026-03-01');

      await vi.waitFor(() => expect(changes).toHaveLength(1));
      await settle();
      expect(changes).toEqual([{ id: 'modis', time: '2026-03-01' }]);
    });

    it('waits for a whole date before doing anything', async () => {
      const { root, changes } = await unfold([MODIS]);

      typeDate(root, '');
      await settle();

      expect(changes).toEqual([]);
    });

    it('drops the date it was settling on when the reader steps instead', async () => {
      const { root, changes } = await unfold([MODIS]);

      typeDate(root, '2026-03-01');
      click(root, '.previous');
      await settle();

      expect(changes).toEqual([{ id: 'modis', time: '2026-09-30' }]);
    });

    it('refuses a day in a gap, once the reader has had a moment to finish typing', async () => {
      const { root, shadowRoot, changes, waitForChanges } = await unfold([MODIS]);

      typeDate(root, '2000-04-26');
      await waitForChanges();
      expect(shadowRoot.querySelector('.refusal')).toBeNull();

      await vi.waitFor(() => expect(shadowRoot.querySelector('.refusal')?.textContent).toEqual('No data for Apr 26, 2000.'));
      expect(changes).toEqual([]);
    });

    // Chrome lets a year be typed that its own calendar wouldn't offer
    it('says how far the layer goes, for a day before its first time or after its last', async () => {
      const { root, shadowRoot } = await unfold([MODIS]);

      typeDate(root, '0016-03-01');
      await vi.waitFor(() => expect(shadowRoot.querySelector('.refusal')?.textContent).toEqual('No data before Feb 24, 2000.'));

      typeDate(root, '2027-01-01');
      await vi.waitFor(() => expect(shadowRoot.querySelector('.refusal')?.textContent).toEqual('No data after Oct 3, 2026.'));
    });

    it('takes a refusal back as soon as a day that has something is picked', async () => {
      const { root, shadowRoot, waitForChanges } = await unfold([MODIS]);
      typeDate(root, '1999-12-31');
      await vi.waitFor(() => expect(shadowRoot.querySelector('.refusal')).not.toBeNull());

      typeDate(root, '2026-03-01');
      await waitForChanges();

      expect(shadowRoot.querySelector('.refusal')).toBeNull();
    });

    it('lists the times on the day being drawn, for a layer with several a day', async () => {
      const { shadowRoot } = await unfold([GEOCOLOR]);
      const options = Array.from(shadowRoot.querySelectorAll<HTMLOptionElement>('.time option'));

      // Ten-minutely from midnight to 23:30
      expect(options).toHaveLength(6 * 24 - 2);
      expect(options[0].textContent).toEqual('00:00 UTC');
      expect(options.find(option => option.selected)?.value).toEqual('2026-10-02T18:50:00Z');
    });

    it('draws the time picked from the list', async () => {
      const { root, changes } = await unfold([GEOCOLOR]);
      const list = getElement(root, '.time') as HTMLSelectElement;

      list.value = '2026-10-02T09:10:00Z';
      list.dispatchEvent(new Event('change', { bubbles: true }));

      expect(changes).toEqual([{ id: 'goes', time: '2026-10-02T09:10:00Z' }]);
    });

    it('keeps to the time of day when another day is picked', async () => {
      const { root, changes } = await unfold([GEOCOLOR]);

      typeDate(root, '2026-10-01');

      await vi.waitFor(() => expect(changes).toEqual([{ id: 'goes', time: '2026-10-01T18:50:00Z' }]));
    });

    it('offers no list of times for a daily layer', async () => {
      const { shadowRoot } = await unfold([MODIS]);
      expect(shadowRoot.querySelector('.time')).toBeNull();
    });

    it('folds away on Escape, back onto the button that unfolded it', async () => {
      const { root, shadowRoot, waitForChanges } = await unfold([MODIS]);

      getElement(root, '.date').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
      await waitForChanges();

      expect(shadowRoot.querySelector('.picker')).toBeNull();
      expect(shadowRoot.activeElement).toBe(shadowRoot.querySelector('.value'));
    });
  });

  // A service can list only some of its times up front - see MapPreviewer.loadTimeDomain
  it('asks for every time a layer offers once the reader starts using its control, and only once', async () => {
    const { root, requests } = await renderTime([MODIS]);
    const control = getElement(root, '.layer');

    expect(requests).toEqual([]);
    control.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    control.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

    expect(requests).toEqual(['modis']);
  });

  it('names each layer’s control when there is more than one', async () => {
    const { shadowRoot } = await renderTime([MODIS, GEOCOLOR]);

    expect(Array.from(shadowRoot.querySelectorAll('.layer .title')).map(title => title.textContent)).toEqual(['Corrected Reflectance (True Color)', 'GeoColor']);
    expect(Array.from(shadowRoot.querySelectorAll('.layer')).map(layer => layer.getAttribute('aria-label'))).toEqual(['Corrected Reflectance (True Color)', 'GeoColor']);
  });

  it('leaves a single layer’s control unnamed, since the panel says what it is', async () => {
    const { shadowRoot } = await renderTime([MODIS]);
    expect(shadowRoot.querySelector('.layer .title')).toBeNull();
  });
});
