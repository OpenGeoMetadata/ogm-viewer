import { Component, Element, Event, EventEmitter, h, Host, Prop, State } from '@stencil/core';

import '@awesome.me/webawesome/dist/components/icon/icon.js';

import { timedLayers, type LayerControl } from '../../lib/layers';
import type TimeDomain from '../../lib/time';
import { DAY, dayValue, describeDay, parseDayValue, parseTime, startOfDay } from '../../lib/time';

// Delay before activating the user's choice in the date field
const SETTLE_DELAY = 500;

// String description of the start or end of the data, e.g. "Apr 28, 2021" or "Apr 28, 2021, 12:00 UTC"
const describeEnd = (domain: TimeDomain, time: number): string => (domain.tellsTimeOfDay ? describeDay(time) : domain.describe(time));

// Date and time control for layers that support browsing using it
@Component({
  tag: 'ogm-time',
  styleUrl: 'ogm-time.css',
  shadow: true,
})
export class OgmTime {
  @Element() el!: HTMLElement;
  @Prop() theme: 'light' | 'dark';
  @Prop() layers: LayerControl[] = [];

  @Event() layerTimeChange: EventEmitter<{ id: string; time: string }>;
  @Event() layerTimeDomainRequest: EventEmitter<{ id: string }>;

  // The layers whose picker is unfolded
  @State() private open: ReadonlySet<string> = new Set();

  // Messages indicating that we can't show a particular chosen date/time
  @State() private refusals: ReadonlyMap<string, string> = new Map();

  private engaged = new Set<string>();
  private settling = new Map<string, ReturnType<typeof setTimeout>>();
  private toggles = new Map<string, HTMLButtonElement>();

  disconnectedCallback() {
    this.settling.forEach(timer => clearTimeout(timer));
    this.settling.clear();
  }

  componentDidRender() {
    this.el.shadowRoot?.querySelectorAll<HTMLSelectElement>('select.time').forEach(list => {
      if (list.dataset.current) list.value = list.dataset.current;
    });
  }

  // Current date/time previewed for a layer, defaulting to latest it has
  private currentOf(layer: LayerControl): number {
    return parseTime(layer.time!) ?? layer.timeDomain!.last!;
  }

  // Called when someone interacts with the layer, so we can check what data it has
  private engage(id: string) {
    if (this.engaged.has(id)) return;
    this.engaged.add(id);
    this.layerTimeDomainRequest.emit({ id });
  }

  // Called when the user picks a new date/time for the layer
  private choose(layer: LayerControl, time: number) {
    this.unsettle(layer.id);
    this.ask(layer, layer.timeDomain!.format(time));
  }

  private ask(layer: LayerControl, time: string) {
    if (time !== layer.time) this.layerTimeChange.emit({ id: layer.id, time });
  }

  private toggle(id: string) {
    const open = new Set(this.open);
    if (!open.delete(id)) open.add(id);
    this.open = open;
    if (!open.has(id)) this.unsettle(id);
  }

  // Fold the picker away and put the focus back on the button that unfolded it
  private close(id: string, event: KeyboardEvent) {
    if (event.key !== 'Escape' || !this.open.has(id)) return;
    event.stopPropagation();
    this.toggle(id);
    this.toggles.get(id)?.focus();
  }

  // A day typed or picked in the date field, acted on once the field has settled
  private pickDay(id: string, value: string) {
    this.unsettle(id);
    this.settling.set(
      id,
      setTimeout(() => {
        this.settling.delete(id);
        this.settleDay(id, value);
      }, SETTLE_DELAY),
    );
  }

  // Handle a newly chosen day
  private settleDay(id: string, value: string) {
    const layer = timedLayers(this.layers).find(each => each.id === id);
    const day = parseDayValue(value);
    if (!layer || day === undefined) return;

    // On another day, keep to the time of day the reader was at
    const domain = layer.timeDomain!;
    const current = this.currentOf(layer);
    const time = domain.forDay(day, current - startOfDay(current));
    if (time !== undefined) {
      this.choose(layer, time);
      return;
    }

    this.refusals = new Map([...this.refusals, [id, this.refusalFor(domain, day)]]);
  }

  // Generate a message saying we don't have that data
  private refusalFor(domain: TimeDomain, day: number): string {
    if (day < startOfDay(domain.first!)) return `No data before ${describeEnd(domain, domain.first!)}.`;
    if (day > domain.last!) return `No data after ${describeEnd(domain, domain.last!)}.`;
    return `No data for ${describeDay(day)}.`;
  }

  private unsettle(id: string) {
    clearTimeout(this.settling.get(id));
    this.settling.delete(id);
    if (!this.refusals.has(id)) return;
    const refusals = new Map(this.refusals);
    refusals.delete(id);
    this.refusals = refusals;
  }

  private renderLayer(layer: LayerControl, index: number, titled: boolean) {
    const domain = layer.timeDomain!;
    const current = this.currentOf(layer);
    const label = parseTime(layer.time!) === undefined ? layer.time! : domain.describe(current);
    const previous = domain.previous(current);
    const next = domain.next(current);
    const open = this.open.has(layer.id);
    const pickerId = `picker-${index}`;

    return (
      <div
        class="layer"
        key={layer.id}
        role={titled ? 'group' : undefined}
        aria-label={titled ? layer.title : undefined}
        onPointerDown={() => this.engage(layer.id)}
        onFocusin={() => this.engage(layer.id)}
        onKeyDown={(event: KeyboardEvent) => this.close(layer.id, event)}
      >
        {titled && (
          <div class="title" title={layer.title}>
            {layer.title}
          </div>
        )}
        <div class="bar">
          <button
            class="step previous"
            type="button"
            disabled={previous === undefined}
            aria-label={previous === undefined ? 'Previous' : `Previous: ${domain.describe(previous)}`}
            title={previous === undefined ? undefined : domain.describe(previous)}
            onClick={() => previous !== undefined && this.choose(layer, previous)}
          >
            <wa-icon name="chevron-left" aria-hidden="true"></wa-icon>
          </button>
          <button
            class="value"
            type="button"
            aria-expanded={String(open)}
            aria-controls={pickerId}
            title={domain.tellsTimeOfDay ? 'Choose a date and time' : 'Choose a date'}
            ref={el => el && this.toggles.set(layer.id, el)}
            onClick={() => this.toggle(layer.id)}
          >
            <span class="label">{label}</span>
            <wa-icon name="chevron-down" aria-hidden="true"></wa-icon>
          </button>
          <button
            class="step next"
            type="button"
            disabled={next === undefined}
            aria-label={next === undefined ? 'Next' : `Next: ${domain.describe(next)}`}
            title={next === undefined ? undefined : domain.describe(next)}
            onClick={() => next !== undefined && this.choose(layer, next)}
          >
            <wa-icon name="chevron-right" aria-hidden="true"></wa-icon>
          </button>
        </div>
        {open && this.renderPicker(layer, domain, current, pickerId)}
        <span class="status" role="status">
          Showing {label}
        </span>
      </div>
    );
  }

  private renderPicker(layer: LayerControl, domain: TimeDomain, current: number, id: string) {
    const day = startOfDay(current);
    const refusal = this.refusals.get(layer.id);

    return (
      <div class="picker" id={id}>
        <label htmlFor={`${id}-date`}>Date</label>
        <input
          id={`${id}-date`}
          class="date"
          type="date"
          min={dayValue(domain.first!)}
          max={dayValue(domain.last!)}
          value={dayValue(current)}
          aria-describedby={`${id}-range`}
          onInput={(event: Event) => this.pickDay(layer.id, (event.target as HTMLInputElement).value)}
        />
        {domain.tellsTimeOfDay && [
          <label htmlFor={`${id}-time`}>Time</label>,
          <select
            id={`${id}-time`}
            class="time"
            data-current={domain.format(current)}
            onChange={(event: Event) => {
              this.unsettle(layer.id);
              this.ask(layer, (event.target as HTMLSelectElement).value);
            }}
          >
            {domain.between(day, day + DAY).map(time => (
              <option value={domain.format(time)} selected={time === current}>
                {domain.describeTimeOfDay(time)} UTC
              </option>
            ))}
          </select>,
        ]}
        <div class="range" id={`${id}-range`}>
          Data covers {describeEnd(domain, domain.first!)} to {describeEnd(domain, domain.last!)}
        </div>
        {refusal && (
          <div class="refusal" role="alert">
            {refusal}
          </div>
        )}
      </div>
    );
  }

  render() {
    const layers = timedLayers(this.layers);
    if (!layers.length) return null;

    const tellsTimeOfDay = layers.some(layer => layer.timeDomain!.tellsTimeOfDay);

    return (
      <Host class={this.theme && `wa-${this.theme}`}>
        <div class={{ 'panel': true, 'tells-time-of-day': tellsTimeOfDay }} role="group" aria-label="Time">
          {layers.map((layer, index) => this.renderLayer(layer, index, layers.length > 1))}
        </div>
      </Host>
    );
  }
}
