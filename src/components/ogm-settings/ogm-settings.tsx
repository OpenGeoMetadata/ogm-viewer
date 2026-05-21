import type { SlRange } from '@shoelace-style/shoelace';
import { Component, Element, Event, EventEmitter, h, Listen, Prop } from '@stencil/core';

import { getElement } from '../../lib/elements';
import type { OgmRecord } from '../../lib/record';

@Component({
  tag: 'ogm-settings',
  styleUrl: 'ogm-settings.css',
  shadow: true,
})
export class OgmSettings {
  @Prop() record: OgmRecord;
  @Element() el: HTMLElement;
  @Event() opacityChange: EventEmitter<number>;

  private slRange: SlRange;

  componentDidLoad() {
    this.slRange = getElement(this.el, 'sl-range') as SlRange;
  }

  @Listen('sl-input')
  handleOpacityChange() {
    this.opacityChange.emit(this.slRange.value);
  }

  render() {
    return (
      <div class="settings">
        <sl-range disabled={!this.record || this.record.references.iiifOnly} label="Layer opacity" min="0" max="100" step="1" value="100"></sl-range>
      </div>
    );
  }
}
