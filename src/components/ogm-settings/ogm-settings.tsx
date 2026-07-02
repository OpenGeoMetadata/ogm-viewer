import type WaSlider from '@awesome.me/webawesome/dist/components/slider/slider.js';
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

  private waSlider: WaSlider;

  componentDidLoad() {
    this.waSlider = getElement(this.el, 'wa-slider') as WaSlider;
  }

  @Listen('input')
  handleOpacityChange() {
    this.opacityChange.emit(this.waSlider.value);
  }

  render() {
    return (
      <div class="settings">
        <wa-slider disabled={!this.record || this.record.references.iiifOnly} label="Layer opacity" min="0" max="100" step="1" value="100"></wa-slider>
      </div>
    );
  }
}
