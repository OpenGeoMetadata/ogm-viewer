import { setBasePath, getBasePath, registerIconLibrary } from '@awesome.me/webawesome';
import { Component, Element, Host, Listen, Method, Prop, State, Watch, getAssetPath, h } from '@stencil/core';

import OgmRecord from '../../lib/record';
import { fetchOrThrow, recordError, type PreviewError } from '../../lib/errors';

// Only need to call this once, at the top level
setBasePath(getAssetPath(''));

// Serve icons from our self-hosted bootstrap-icons subset instead of the default Font Awesome library
registerIconLibrary('default', {
  resolver: name => getBasePath(`assets/icons/${name}.svg`),
});

// Import all required Web Awesome components
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/callout/callout.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/scroller/scroller.js';
import '@awesome.me/webawesome/dist/components/slider/slider.js';
import '@awesome.me/webawesome/dist/components/spinner/spinner.js';
import '@awesome.me/webawesome/dist/components/tab-group/tab-group.js';
import '@awesome.me/webawesome/dist/components/tab-panel/tab-panel.js';
import '@awesome.me/webawesome/dist/components/tab/tab.js';
import '@awesome.me/webawesome/dist/components/tooltip/tooltip.js';

// Web Awesome activates its palette and semantic color variants on `:root` by default (with
// `.wa-*` classes only needed to override the defaults). `:root` never matches inside a shadow
// tree, so we opt into each default explicitly on our container to reproduce what a document-level
// load would give us: the default palette plus the default hue for every color variant.
const WA_SCOPE = 'wa-palette-default wa-brand-blue wa-neutral-gray wa-success-green wa-warning-yellow wa-danger-red';

@Component({
  tag: 'ogm-viewer',
  styleUrl: 'ogm-viewer.css',
  shadow: true,
})
export class OgmViewer {
  @Element() el: HTMLElement;
  @Prop() recordUrl: string;
  @Prop() theme: 'light' | 'dark' = this.getThemePreference();
  @Prop() hideTitle: boolean = false;
  @State() record?: OgmRecord;
  @State() error?: PreviewError;
  @State() previewOpacity: number = 100;
  @State() sidebarOpen: boolean = false;
  @State() loading: boolean = false;

  private loadingCount: number = 0;
  private sidebarPadding: number = 0;

  // Prior to rendering, fetch the record if a URL is provided
  async componentWillLoad() {
    if (this.recordUrl) return await this.updateRecord();
  }

  // Check the user's theme preference via CSS media query
  private getThemePreference() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  // Shift the map/image over when the sidebar is toggled open
  @Listen('sidebarToggled')
  toggleSidebar() {
    this.sidebarOpen = !this.sidebarOpen;
    this.sidebarPadding = this.sidebarOpen ? 400 : 0;
  }

  // When URL changes, fetch the new record
  @Watch('recordUrl')
  async updateRecord() {
    this.record = await this.fetchRecord(this.recordUrl);
  }

  // Can be called externally to set the record directly
  @Method()
  async loadRecord(record: OgmRecord) {
    this.error = undefined;
    this.record = record;
  }

  // Listen for opacity changes from the sidebar and adjust the preview layer
  @Listen('opacityChange')
  adjustPreviewOpacity(event: CustomEvent<number>) {
    this.previewOpacity = event.detail;
  }

  // Listen for a preview to report loading started
  @Listen('mapLoading')
  @Listen('imageLoading')
  setLoadingStarted() {
    this.loadingCount++;
    this.loading = true;
  }

  // When all in-flight previews have loaded, clear loading state
  @Listen('mapIdle')
  @Listen('imageLoaded')
  setLoadingFinished() {
    this.loadingCount = Math.max(0, this.loadingCount - 1);
    this.loading = this.loadingCount > 0;
  }

  // When a new record loads, reset the loading count and loading state
  @Watch('record')
  resetLoading() {
    this.loadingCount = 0;
    this.loading = false;
  }

  // Fetch a record by URL and parse it into an OgmRecord instance.
  private async fetchRecord(recordUrl: string): Promise<OgmRecord | undefined> {
    this.error = undefined;
    try {
      const response = await fetchOrThrow(recordUrl);
      const data = await response.json();
      return new OgmRecord(data);
    } catch (error) {
      console.error(`Error loading record ${recordUrl}:`, error);
      this.error = recordError(error, recordUrl);
      return undefined;
    }
  }

  // Link Web Awesome's stylesheet inside the shadow tree so it doesn't
  // leak into the host page when rendering.
  render() {
    return (
      <Host class={`wa-${this.theme}`}>
        <link rel="stylesheet" href={getBasePath('assets/webawesome/styles/themes/default.css')} />
        <div class={`container ${WA_SCOPE} wa-${this.theme}`}>
          <ogm-menubar theme={this.theme} record={this.record} loading={this.loading} hideTitle={this.hideTitle}></ogm-menubar>
          <div class="main-container">
            <ogm-sidebar theme={this.theme} record={this.record} open={this.sidebarOpen}></ogm-sidebar>
            {this.error ? (
              <ogm-alerts theme={this.theme} error={this.error}></ogm-alerts>
            ) : (
              <ogm-previews theme={this.theme} record={this.record} preview-opacity={this.previewOpacity} sidebar-padding={this.sidebarPadding}></ogm-previews>
            )}
          </div>
        </div>
      </Host>
    );
  }
}
