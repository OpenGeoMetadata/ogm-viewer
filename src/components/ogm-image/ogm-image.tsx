import { Component, Element, h, Host, Watch, Prop, Event, EventEmitter, State } from '@stencil/core';
import { Viewer } from 'openseadragon';

import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';

import { closestAcrossShadows, getElement, findElement } from '../../lib/elements';
import { referenceError, type PreviewError } from '../../lib/errors';
import { adoptWebAwesomeTheme, initialTheme, waScope } from '../../lib/init';
import type ImagePreviewer from '../../lib/previewers/image';
import Theme from '../../lib/themes/theme';

@Component({
  tag: 'ogm-image',
  styleUrl: 'ogm-image.css',
  shadow: true,
})
export class OgmImage {
  @Element() el!: HTMLElement;
  @Prop() previewer: ImagePreviewer;
  @Prop() theme: 'light' | 'dark' = initialTheme(this.el);
  @Prop() padding: number = 0;
  @Event() imageLoaded: EventEmitter<void>;
  @Event() imageLoading: EventEmitter<void>;
  @Event() previewError: EventEmitter<PreviewError>;

  private viewer: Viewer;

  private imageTheme: Theme;

  private errorReported: boolean = false;

  componentWillLoad() {
    adoptWebAwesomeTheme(this.el);
  }

  @State() fullscreen: boolean = false;
  private fullscreenFallback: boolean = false;
  private fullscreenFallbackElement?: HTMLElement;

  async componentDidLoad() {
    const scope = getElement(this.el, '#openseadragon');
    this.imageTheme = new Theme(scope, this.theme);
    this.viewer = new Viewer({
      element: scope,
      viewportMargins: this.margins(),
      prefixUrl: 'https://cdnjs.cloudflare.com/ajax/libs/openseadragon/6.1.1/images/',
      visibilityRatio: 1,
      sequenceMode: true,
      showReferenceStrip: true,
      crossOriginPolicy: 'Anonymous',
      zoomInButton: getElement(this.el, '.zoom-in'),
      zoomOutButton: getElement(this.el, '.zoom-out'),
      homeButton: getElement(this.el, '.home'),
      nextButton: getElement(this.el, '.next'),
      previousButton: getElement(this.el, '.prev'),
    });

    // OpenSeadragon's full-page mode detaches shadow-hosted content; fullscreen the host instead.
    document.addEventListener('fullscreenchange', this.onFullscreenChange);
    document.addEventListener('keydown', this.onFullscreenKeydown);

    this.viewer.addHandler('open', () => this.imageLoaded.emit());

    this.viewer.addHandler('open-failed', event => {
      this.imageLoaded.emit();
      this.reportError(new Error(event.message));
    });

    await this.loadPreview();
  }

  disconnectedCallback() {
    document.removeEventListener('fullscreenchange', this.onFullscreenChange);
    document.removeEventListener('keydown', this.onFullscreenKeydown);
    this.exitFullscreenFallback();
    this.viewer?.destroy();
  }

  @Watch('previewer')
  async onPreviewerChange(_previewer: ImagePreviewer, previous?: ImagePreviewer) {
    if (previous) await previous.clearPreview();
    await this.loadPreview();
  }

  @Watch('padding')
  async onPaddingChange() {
    if (!this.viewer) return;

    const filmstrip = findElement(this.el, '.referencestrip');
    if (filmstrip) filmstrip.style.setProperty('margin-left', `${this.padding}px`);

    return this.viewer.viewport.setMargins(this.margins());
  }

  // OpenSeadragon replaces all margins, so every edge must be supplied together.
  private margins() {
    const padding = this.imageTheme.getPadding();
    return { top: padding, bottom: padding, right: padding, left: padding + this.padding };
  }

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

  private reportError(error?: unknown) {
    if (this.errorReported || !this.previewer) return;
    this.errorReported = true;
    this.previewError.emit(referenceError(error, this.previewer.label(), this.previewer.url));
  }

  private onFullscreenChange = () => {
    this.fullscreen = this.fullscreenTarget().matches(':fullscreen') || this.fullscreenFallback;
  };

  private onFullscreenKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && this.fullscreenFallback) this.exitFullscreenFallback();
  };

  private exitFullscreenFallback() {
    this.fullscreenFallbackElement?.removeAttribute('data-ogm-fullscreen-fallback');
    this.fullscreenFallbackElement = undefined;
    this.fullscreenFallback = false;
    this.fullscreen = false;
  }

  // Fullscreen the enclosing viewer to keep its menubar and sidebar accessible.
  private fullscreenTarget(): HTMLElement {
    return closestAcrossShadows(this.el, 'ogm-viewer') ?? this.el;
  }

  private async toggleFullscreen() {
    if (this.fullscreenFallback) {
      this.exitFullscreenFallback();
      return;
    }

    if (this.fullscreen) {
      await document.exitFullscreen();
      this.fullscreen = false;
      return;
    }

    try {
      await this.fullscreenTarget().requestFullscreen();
      this.fullscreen = true;
    } catch {
      this.fullscreenFallbackElement = this.fullscreenTarget();
      this.fullscreenFallbackElement.setAttribute('data-ogm-fullscreen-fallback', '');
      this.fullscreenFallback = true;
      this.fullscreen = true;
    }
  }

  render() {
    return (
      <Host class={waScope(this.theme)}>
        <div id="openseadragon" class={waScope(this.theme)}>
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
            <wa-button class="full-page" size="s" appearance="filled-outlined" pill onClick={() => this.toggleFullscreen()}>
              <wa-icon name="arrows-fullscreen" label={this.fullscreen ? 'Exit Full Screen' : 'Full Screen'} canvas="auto"></wa-icon>
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
