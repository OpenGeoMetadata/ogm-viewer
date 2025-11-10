import { Component, Element, h, Host, Watch, Prop, Event, EventEmitter } from '@stencil/core';
import OpenSeadragon from 'openseadragon';
import { ControlAnchor } from 'openseadragon';

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
  @Event() imageLoaded: EventEmitter<void>;
  @Event() imageLoading: EventEmitter<void>;

  // OpenSeadragon viewer instance
  private viewer: OpenSeadragon.Viewer;

  // Set up OpenSeadragon viewer on load
  async componentDidLoad() {
    this.viewer = OpenSeadragon({
      element: this.el.shadowRoot.getElementById('openseadragon'),
      prefixUrl: "https://cdnjs.cloudflare.com/ajax/libs/openseadragon/2.4.2/images/",
      visibilityRatio: 1,
      sequenceMode: true,
      toolbar: this.el.shadowRoot.querySelector('.controls'),
    });
    this.viewer.addHandler('open', () => this.imageLoaded.emit());
    if (this.record) await this.loadImages();
  }

  // Update preview when record changes
  @Watch('record')
  async onRecordChange() {
    if (this.record) await this.loadImages();
  }

  // Get all of the IIIF image URLs and send them to OpenSeadragon
  // This makes a request to fetch and cache the manifest
  private async loadImages() {
    this.imageLoading.emit();
    const images = await this.record.references.iiifImages();
    this.viewer.open(images);
  }

  render() {
    return (
      <Host>
        <div id="openseadragon">
          <div class="controls">
          </div>
        </div>
      </Host>
    );
  }
}
