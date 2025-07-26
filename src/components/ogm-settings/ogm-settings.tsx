import { Component, Listen, Prop, EventEmitter, Event, Element, h } from '@stencil/core';
import type { OgmRecord } from '../../utils/record';
import type { SlRange } from '@shoelace-style/shoelace';

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
    this.slRange = this.el.shadowRoot.querySelector('sl-range');
  }

  @Listen('sl-input')
  handleOpacityChange() {
    this.opacityChange.emit(this.slRange.value);
  }

  render() {
    return (
      <div class="settings">
        <sl-range label="Layer opacity" min="0" max="100" step="1" value="100"></sl-range>
      </div>
    );
  }
}
