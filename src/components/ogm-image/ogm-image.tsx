import { Component, Element, h, Host, Watch, Prop, Event, EventEmitter } from '@stencil/core';
import { Viewer } from 'openseadragon';

import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';

import { getElement, findElement } from '../../lib/elements';
import { referenceError, type PreviewError } from '../../lib/errors';
import { themePreference, waScope, webAwesomeStylesheet } from '../../lib/init';
import type ImagePreviewer from '../../lib/previewers/image';

@Component({
  tag: 'ogm-image',
  styleUrl: 'ogm-image.css',
  shadow: true,
})
export class OgmImage {
  @Element() el: HTMLElement;
  @Prop() previewer: ImagePreviewer;
  @Prop() theme: 'light' | 'dark' = themePreference();
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

    // The viewer is ready, so whatever preview we were given can be drawn into it
    await this.loadPreview();
  }

  // Destroy the viewer when we are removed from the DOM
  disconnectedCallback() {
    this.viewer?.destroy();
  }

  // A different preview to draw. The one leaving closes itself out of the viewer first.
  @Watch('previewer')
  async onPreviewerChange(_previewer: ImagePreviewer, previous?: ImagePreviewer) {
    if (previous) await previous.clearPreview();
    await this.loadPreview();
  }

  @Watch('padding')
  async onPaddingChange() {
    // Move the filmstrip if there is one
    const filmstrip = findElement(this.el, '.referencestrip');
    if (filmstrip) filmstrip.style.setProperty('margin-left', `${this.padding}px`);

    // Move the viewer viewport
    return await this.viewer.viewport.setMargins({ left: this.padding });
  }

  // Draw the current preview into the viewer. Reading a manifest is a fetch, so this is where a
  // IIIF preview first has the chance to fail.
  private async loadPreview() {
    if (!this.previewer || !this.viewer) return;

    this.errorReported = false;
    this.imageLoading.emit();

    try {
      this.previewer.attach(this.viewer);
      await this.previewer.preview();
    } catch (error) {
      console.error(`Error previewing ${this.previewer.url}:`, error);
      this.imageLoaded.emit();
      this.reportError(error);
    }
  }

  // Emit a single preview error per load attempt
  private reportError(error?: unknown) {
    if (this.errorReported || !this.previewer) return;
    this.errorReported = true;
    this.previewError.emit(referenceError(error, this.previewer.label(), this.previewer.url));
  }

  render() {
    return (
      <Host class={waScope(this.theme)}>
        <link rel="stylesheet" href={webAwesomeStylesheet()} />
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
