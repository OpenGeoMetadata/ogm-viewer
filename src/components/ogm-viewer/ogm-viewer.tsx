import { setBasePath } from '@shoelace-style/shoelace/dist/utilities/base-path.js';
import { Component, Element, Listen, Method, Prop, State, Watch, getAssetPath, h } from '@stencil/core';

import { OgmRecord } from '../../utils/record';

// Only need to call this once, at the top level
setBasePath(getAssetPath(''));

// Import all required Shoelace components
import '@shoelace-style/shoelace/dist/components/drawer/drawer.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/icon-button/icon-button.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/range/range.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@shoelace-style/shoelace/dist/components/tab-group/tab-group.js';
import '@shoelace-style/shoelace/dist/components/tab-panel/tab-panel.js';
import '@shoelace-style/shoelace/dist/components/tab/tab.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';

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
  @State() sidebarOpen: boolean = false;
  @State() previewOpacity: number = 100;

  private loading: boolean = false;
  private map: HTMLOgmMapElement;

  // Prior to rendering, fetch the record if a URL is provided
  async componentWillLoad() {
    if (this.recordUrl) return await this.updateRecord();
  }

  // Check the user's theme preference via CSS media query
  private getThemePreference() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  // After rendering, find the map element in the shadow DOM, if it's there
  componentDidRender() {
    this.map = this.el.shadowRoot.querySelector('ogm-map');
  }

  // Shift the map/image over when the sidebar is toggled open
  @Listen('sidebarToggled')
  toggleSidebar() {
    this.sidebarOpen = !this.sidebarOpen;
    if (!this.map) return;
    if (this.sidebarOpen) this.map.easeMapTo({ padding: { left: 400 } });
    else this.map.easeMapTo({ padding: { left: 20 } });
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

  // Choose a preview component based on the record type
  private renderPreview() {
    if (this.record && this.record.references.iiifOnly) return <ogm-image theme={this.theme} record={this.record}></ogm-image>;
    return <ogm-map preview-opacity={this.previewOpacity} theme={this.theme} record={this.record}></ogm-map>;
  }

  render() {
    return (
      <div class={`container sl-theme-${this.theme}`}>
        <ogm-menubar theme={this.theme} record={this.record} loading={this.loading}></ogm-menubar>
        <div class="main-container">
          <ogm-sidebar theme={this.theme} record={this.record} open={this.sidebarOpen}></ogm-sidebar>
          {this.renderPreview()}
        </div>
      </div>
    );
  }
}
