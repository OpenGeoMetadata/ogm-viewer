import { Component, Element, h, Host, Watch, Prop, Event, EventEmitter } from '@stencil/core';
import { Viewer } from 'openseadragon';

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
  private viewer: Viewer;

  // Set up OpenSeadragon viewer on load
  async componentDidLoad() {
    this.viewer = new Viewer({
      element: this.el.shadowRoot.getElementById('openseadragon'),
      prefixUrl: 'https://cdnjs.cloudflare.com/ajax/libs/openseadragon/2.4.2/images/',
      visibilityRatio: 1,
      sequenceMode: true,
      drawer: typeof jest === 'undefined' ? 'webgl' : 'html', // No WebGL in tests
      zoomInButton: this.el.shadowRoot.querySelector('.zoom-in'),
      zoomOutButton: this.el.shadowRoot.querySelector('.zoom-out'),
      homeButton: this.el.shadowRoot.querySelector('.home'),
      fullPageButton: this.el.shadowRoot.querySelector('.full-page'),
      nextButton: this.el.shadowRoot.querySelector('.next'),
      previousButton: this.el.shadowRoot.querySelector('.prev'),
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
            <sl-button class="zoom-in" size="small" circle>
              <sl-icon name="zoom-in" label="Zoom In"></sl-icon>
            </sl-button>
            <sl-button class="zoom-out" size="small" circle>
              <sl-icon name="zoom-out" label="Zoom Out"></sl-icon>
            </sl-button>
            <sl-button class="home" size="small" circle>
              <sl-icon name="house" label="Reset View"></sl-icon>
            </sl-button>
            <sl-button class="full-page" size="small" circle>
              <sl-icon name="arrows-fullscreen" label="Full Screen"></sl-icon>
            </sl-button>
            <sl-button class="next" size="small" circle>
              <sl-icon name="arrow-right" label="Next"></sl-icon>
            </sl-button>
            <sl-button class="prev" size="small" circle>
              <sl-icon name="arrow-left" label="Previous"></sl-icon>
            </sl-button>
          </div>
        </div>
      </Host>
    );
  }
}
