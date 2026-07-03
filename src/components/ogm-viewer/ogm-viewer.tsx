import { setBasePath, getBasePath, registerIconLibrary } from '@awesome.me/webawesome';
import { Component, Element, Host, Listen, Method, Prop, State, Watch, getAssetPath, h } from '@stencil/core';

import OgmRecord from '../../lib/record';

// Only need to call this once, at the top level
setBasePath(getAssetPath(''));

// Serve icons from our self-hosted bootstrap-icons subset instead of the default Font Awesome library
registerIconLibrary('default', {
  resolver: name => getBasePath(`assets/icons/${name}.svg`),
});

// Web Awesome's raw color palette is scoped to `:root`, which can only ever match the actual
// document root - never an element inside a shadow tree, so a component-scoped @import can't
// activate it. Loading it here, at the document level, lets it match `:root` for real, and lets
// its `.wa-light`/`.wa-dark` theme rules match the <ogm-viewer> host itself (see render() below),
// from which every token inherits down through the rest of the shadow tree. Injecting it here
// means consumers don't have to remember to add it to their own page.
function loadWebAwesomeStylesheet() {
  const id = 'ogm-viewer-webawesome-styles';
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = getBasePath('assets/webawesome/styles/webawesome.css');
  document.head.appendChild(link);
}
loadWebAwesomeStylesheet();

// Import all required Web Awesome components
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/scroller/scroller.js';
import '@awesome.me/webawesome/dist/components/slider/slider.js';
import '@awesome.me/webawesome/dist/components/spinner/spinner.js';
import '@awesome.me/webawesome/dist/components/tab-group/tab-group.js';
import '@awesome.me/webawesome/dist/components/tab-panel/tab-panel.js';
import '@awesome.me/webawesome/dist/components/tab/tab.js';
import '@awesome.me/webawesome/dist/components/tooltip/tooltip.js';

@Component({
  tag: 'ogm-viewer',
  styleUrl: 'ogm-viewer.css',
  shadow: true,
})
export class OgmViewer {
  @Element() el: HTMLElement;
  @Prop() recordUrl: string;
  @Prop() theme: 'light' | 'dark' = this.getThemePreference();
  @State() record: OgmRecord;
  @State() previewOpacity: number = 100;
  @State() sidebarOpen: boolean = false;

  private loading: boolean = false;
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
    this.record = record;
  }

  // Listen for opacity changes from the sidebar and adjust the preview layer
  @Listen('opacityChange')
  adjustPreviewOpacity(event: CustomEvent<number>) {
    this.previewOpacity = event.detail;
  }

  // Listen for map to report loading started
  @Listen('mapLoading')
  @Listen('imageLoading')
  setLoadingStarted() {
    this.loading = true;
  }

  // Listen for map to report loading finished
  @Listen('mapIdle')
  @Listen('imageLoaded')
  setLoadingFinished() {
    this.loading = false;
  }

  // Fetch a record by URL and parse it into an OgmRecord instance
  private async fetchRecord(recordUrl: string): Promise<OgmRecord> {
    const response = await fetch(recordUrl);
    const data = await response.json();
    return new OgmRecord(data);
  }

  render() {
    return (
      // Applying the theme class to the host (rather than an internal div) lets the document-level
      // Web Awesome stylesheet's `.wa-light`/`.wa-dark` rules match it directly, since the host sits
      // in the consuming page's own light DOM while everything inside this shadow root does not.
      <Host class={`wa-${this.theme}`}>
        <div class="container">
          <ogm-menubar theme={this.theme} record={this.record} loading={this.loading}></ogm-menubar>
          <div class="main-container">
            <ogm-sidebar theme={this.theme} record={this.record} open={this.sidebarOpen}></ogm-sidebar>
            <ogm-previews theme={this.theme} record={this.record} preview-opacity={this.previewOpacity} sidebar-padding={this.sidebarPadding}></ogm-previews>
          </div>
        </div>
      </Host>
    );
  }
}
