import { Component, Element, h, Host, Watch, Prop, Event, EventEmitter, Method, State } from '@stencil/core';
import { Viewer } from 'openseadragon';

import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';

import { getElement, findElement } from '../../lib/elements';
import { referenceError, type PreviewError } from '../../lib/errors';
import { adoptWebAwesomeTheme, initialTheme, waScope } from '../../lib/init';
import type ImagePreviewer from '../../lib/previewers/image';
import Theme from '../../lib/themes/theme';
import { pixelRegionFor, type ContentSearchAnnotation, type PixelRegion } from '../../lib/content-search';

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

  // OpenSeadragon viewer instance
  private viewer: Viewer;

  // Where the gap left around a scan comes from, the same place a map's comes from
  private imageTheme: Theme;

  // Guards against reporting more than one error per load attempt
  private errorReported: boolean = false;

  // A Content Search result stays selected while its image is opening. OpenSeadragon can only
  // convert image pixels once the tile source is ready, so an early click is applied on `open`.
  private pendingRegion?: PixelRegion;
  private searchHighlight?: HTMLElement;

  // Before the first frame, so nothing paints unstyled
  componentWillLoad() {
    adoptWebAwesomeTheme(this.el);
  }

  @State() fullscreen: boolean = false;
  @State() fullscreenFallback: boolean = false;

  // Set up OpenSeadragon viewer on load
  async componentDidLoad() {
    // #openseadragon rather than the host for the same reason <ogm-map> reads from its container: it
    // is the element carrying the Web Awesome scope, and the host has no colors on it to read. What
    // this one reads is only --ogm-padding, which comes from outside either way, but a Theme pointed
    // at the host is the shape of the bug that left a standalone map drawing in empty colors.
    const scope = getElement(this.el, '#openseadragon');
    this.imageTheme = new Theme(scope, this.theme);
    this.viewer = new Viewer({
      element: scope,
      // Given to the viewer rather than set afterwards: OpenSeadragon works out where "home" is from
      // the margins in place when an image opens, and setMargins() doesn't refit one already open.
      viewportMargins: this.margins(),
      prefixUrl: 'https://cdnjs.cloudflare.com/ajax/libs/openseadragon/2.4.2/images/',
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

    // OpenSeadragon's full-page implementation temporarily removes every child from <body>. A
    // viewer mounted in this component's shadow root then disappears from document.getElementById,
    // so OpenSeadragon throws before it can put the image back. Keep the shadow tree together and
    // ask the browser to fullscreen its host instead.
    document.addEventListener('fullscreenchange', this.onFullscreenChange);
    document.addEventListener('keydown', this.onFullscreenKeydown);

    // Clear loading state whether we succeeded or failed
    this.viewer.addHandler('open', () => {
      this.imageLoaded.emit();
      this.showPendingRegion();
    });

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
    document.removeEventListener('fullscreenchange', this.onFullscreenChange);
    document.removeEventListener('keydown', this.onFullscreenKeydown);
    this.removeSearchHighlight();
    this.viewer?.destroy();
  }

  // A different preview to draw. The one leaving closes itself out of the viewer first.
  @Watch('previewer')
  async onPreviewerChange(_previewer: ImagePreviewer, previous?: ImagePreviewer) {
    if (previous) await previous.clearPreview();
    this.pendingRegion = undefined;
    this.removeSearchHighlight();
    await this.loadPreview();
  }

  /** Focus the image-pixel selector carried by a IIIF Content Search annotation. */
  @Method()
  async focusAnnotation(annotation: ContentSearchAnnotation): Promise<boolean> {
    const region = pixelRegionFor(annotation);
    if (!region) return false;
    this.pendingRegion = region;
    if (this.viewer?.world?.getItemCount()) this.showPendingRegion();
    return true;
  }

  @Watch('padding')
  async onPaddingChange() {
    if (!this.viewer) return;

    // Move the filmstrip if there is one
    const filmstrip = findElement(this.el, '.referencestrip');
    if (filmstrip) filmstrip.style.setProperty('margin-left', `${this.padding}px`);

    // Move the viewer viewport
    return this.viewer.viewport.setMargins(this.margins());
  }

  // The room to leave around a scan: the theme's gap on every edge, and on the left whatever the
  // sidebar is covering as well. All four edges every time, because OpenSeadragon replaces the whole
  // set with what it's given rather than merging it, so a margin left out is a margin set to zero.
  private margins() {
    const padding = this.imageTheme.getPadding();
    return { top: padding, bottom: padding, right: padding, left: padding + this.padding };
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

  private showPendingRegion() {
    if (!this.pendingRegion || !this.viewer) return;
    this.removeSearchHighlight();

    const { x, y, width, height } = this.pendingRegion;
    const bounds = this.viewer.viewport.imageToViewportRectangle(x, y, width, height);
    const highlight = document.createElement('div');
    highlight.className = 'content-search-highlight';
    highlight.setAttribute('role', 'img');
    highlight.setAttribute('aria-label', 'Selected search result');
    this.viewer.addOverlay({ element: highlight, location: bounds });
    this.viewer.viewport.fitBounds(bounds, true);
    this.searchHighlight = highlight;
  }

  private removeSearchHighlight() {
    if (!this.searchHighlight) return;
    this.viewer?.removeOverlay(this.searchHighlight);
    this.searchHighlight.remove();
    this.searchHighlight = undefined;
  }

  private onFullscreenChange = () => {
    this.fullscreen = this.el.matches(':fullscreen') || this.fullscreenFallback;
  };

  private onFullscreenKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && this.fullscreenFallback) this.exitFullscreenFallback();
  };

  private exitFullscreenFallback() {
    this.fullscreenFallback = false;
    this.fullscreen = false;
  }

  private async toggleFullscreen() {
    if (this.fullscreenFallback) {
      this.exitFullscreenFallback();
      return;
    }

    // document.fullscreenElement may be retargeted to an outer shadow host. Our state is updated
    // from the element's :fullscreen match instead, so the same button remains a reliable exit.
    if (this.fullscreen) {
      await document.exitFullscreen();
      this.fullscreen = false;
      return;
    }

    try {
      await this.el.requestFullscreen();
      this.fullscreen = true;
    } catch {
      // Fullscreen may be unavailable in an embedding context. A fixed-position host preserves the
      // same useful full-window view without moving the OpenSeadragon node out of its shadow root.
      this.fullscreenFallback = true;
      this.fullscreen = true;
    }
  }

  // The scope goes on #openseadragon as well as on the Host: the palette is established by plain
  // class selectors, which the stylesheet linked here can't match against its own shadow host. The
  // controls below and the viewer's own background read from it.
  render() {
    return (
      <Host class={`${waScope(this.theme)}${this.fullscreenFallback ? ' fullscreen-fallback' : ''}`}>
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
