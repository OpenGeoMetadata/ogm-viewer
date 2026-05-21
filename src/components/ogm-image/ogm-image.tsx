import { Component, Element, h, Host, Watch, Prop, Event, EventEmitter } from '@stencil/core';
import { Viewer } from 'openseadragon';

import { getElement, findElement } from '../../lib/elements';
import type { OgmRecord } from '../../lib/record';

@Component({
  tag: 'ogm-image',
  styleUrl: 'ogm-image.css',
  shadow: true,
})
export class OgmImage {
  @Element() el: HTMLElement;
  @Prop() record: OgmRecord;
  @Prop() theme: 'light' | 'dark';
  @Prop() padding: number = 0;
  @Event() imageLoaded: EventEmitter<void>;
  @Event() imageLoading: EventEmitter<void>;

  // OpenSeadragon viewer instance
  private viewer: Viewer;

  // Set up OpenSeadragon viewer on load
  async componentDidLoad() {
    this.viewer = new Viewer({
      element: getElement(this.el, '#openseadragon'),
      prefixUrl: 'https://cdnjs.cloudflare.com/ajax/libs/openseadragon/2.4.2/images/',
      visibilityRatio: 1,
      sequenceMode: true,
      showReferenceStrip: true,
      crossOriginPolicy: 'Anonymous',
      zoomInButton: getElement(this.el, '.zoom-in'),
      zoomOutButton: getElement(this.el, '.zoom-out'),
      homeButton: getElement(this.el, '.home'),
      fullPageButton: getElement(this.el, '.full-page'),
      nextButton: getElement(this.el, '.next'),
      previousButton: getElement(this.el, '.prev'),
    });
    this.viewer.addHandler('open', () => this.imageLoaded.emit());
    if (this.record) await this.loadImages();
  }

  // Update preview when record changes
  @Watch('record')
  async onRecordChange() {
    if (this.record) await this.loadImages();
  }

  @Watch('padding')
  async onPaddingChange() {
    // Move the filmstrip if there is one
    const filmstrip = findElement(this.el, '.referencestrip');
    if (filmstrip) filmstrip.style.setProperty('margin-left', `${this.padding}px`);

    // Move the viewer viewport
    return await this.viewer.viewport.setMargins({ left: this.padding });
  }

  // Get all of the IIIF image URLs and send them to OpenSeadragon
  // This makes a request to fetch and cache the manifest
  private async loadImages() {
    this.imageLoading.emit();
    const images = await this.record.references.iiifImages();
    if (!images) throw new Error('No IIIF images found for record');
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
