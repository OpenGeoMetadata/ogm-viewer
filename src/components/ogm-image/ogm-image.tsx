import { Component, Element, h, Host, Prop } from '@stencil/core';
import OpenSeadragon from 'openseadragon';
import { BOTTOM_RIGHT } from 'openseadragon';

import type { OgmRecord } from '../../utils/record';

@Component({
  tag: 'ogm-image',
  styleUrl: 'ogm-image.css',
  shadow: true,
})
export class OgmImage {
  @Element() el: HTMLElement;
  @Prop() record: OgmRecord;
  @Prop() theme: 'light' | 'dark';

  componentDidLoad() {
    OpenSeadragon({
      element: this.el.shadowRoot.getElementById('openseadragon'),
      tileSources: [this.record.references.iiifImage],
      prefixUrl: "https://cdnjs.cloudflare.com/ajax/libs/openseadragon/2.4.2/images/",
      autoHideControls: false,
      navigationControlAnchor: BOTTOM_RIGHT,
      visibilityRatio: 1,
    });
  }

  render() {
    return (
      <Host>
        <div id="openseadragon"></div>
      </Host>
    );
  }
}
