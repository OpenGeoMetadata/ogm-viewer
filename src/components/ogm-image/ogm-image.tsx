import { Component, Element, h, Host, Watch, Prop, Event, EventEmitter } from '@stencil/core';
import { Viewer } from 'openseadragon';

import { getElement, findElement } from '../../lib/elements';
import { referenceError, type PreviewError } from '../../lib/errors';
import type IIIFSource from '../../lib/sources/iiif';

@Component({
  tag: 'ogm-image',
  styleUrl: 'ogm-image.css',
  shadow: true,
})
export class OgmImage {
  @Element() el: HTMLElement;
  @Prop() source: IIIFSource;
  @Prop() theme: 'light' | 'dark';
  @Prop() padding: number = 0;
  @Event() imageLoaded: EventEmitter<void>;
  @Event() imageLoading: EventEmitter<void>;
  @Event() previewError: EventEmitter<PreviewError>;

  // OpenSeadragon viewer instance
  private viewer: Viewer;

  // Guards against reporting more than one error per load attempt
  private errorReported: boolean = false;

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

    // Clear loading state whether we succeeded or failed
    this.viewer.addHandler('open', () => this.imageLoaded.emit());

    // Surface OpenSeaDragon decode errors here
    this.viewer.addHandler('open-failed', event => {
      this.imageLoaded.emit();
      this.reportError(new Error(event.message));
    });

    // If we do have a source, load the images
    if (this.source) await this.loadImages();
  }

  // Destroy the viewer when we are removed from the DOM
  disconnectedCallback() {
    this.viewer?.destroy();
  }

  // Update preview when source changes
  @Watch('source')
  async onSourceChange() {
    if (this.source) await this.loadImages();
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
    this.errorReported = false;
    this.imageLoading.emit();

    try {
      const images = await this.source.getIIIFImageUrls();
      if (!images) throw new Error('No IIIF images found for source');
      this.viewer.open(images);
    } catch (error) {
      console.error(`Error loading IIIF images for ${this.source.url}:`, error);
      this.imageLoaded.emit();
      this.reportError(error);
    }
  }

  // Emit a single preview error per load attempt
  private reportError(error?: unknown) {
    if (this.errorReported || !this.source) return;
    this.errorReported = true;
    this.previewError.emit(referenceError(error, this.source.label(), this.source.url));
  }

  render() {
    return (
      <Host>
        <div id="openseadragon">
          <div class="controls">
            <wa-button class="zoom-in" size="s" appearance="filled-outlined" pill>
              <wa-icon name="zoom-in" label="Zoom In" canvas="auto"></wa-icon>
            </wa-button>
            <wa-button class="zoom-out" size="s" appearance="filled-outlined" pill>
              <wa-icon name="zoom-out" label="Zoom Out" canvas="auto"></wa-icon>
            </wa-button>
            <wa-button class="home" size="s" appearance="filled-outlined" pill>
              <wa-icon name="house" label="Reset View" canvas="auto"></wa-icon>
            </wa-button>
            <wa-button class="full-page" size="s" appearance="filled-outlined" pill>
              <wa-icon name="arrows-fullscreen" label="Full Screen" canvas="auto"></wa-icon>
            </wa-button>
            <wa-button class="next" size="s" appearance="filled-outlined" pill>
              <wa-icon name="arrow-right" label="Next" canvas="auto"></wa-icon>
            </wa-button>
            <wa-button class="prev" size="s" appearance="filled-outlined" pill>
              <wa-icon name="arrow-left" label="Previous" canvas="auto"></wa-icon>
            </wa-button>
          </div>
        </div>
      </Host>
    );
  }
}
