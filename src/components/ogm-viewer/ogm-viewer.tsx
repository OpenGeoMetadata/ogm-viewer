import { Component, Element, Prop, Watch, State, Listen, h, getAssetPath } from '@stencil/core';
import { setBasePath } from '@shoelace-style/shoelace/dist/utilities/base-path.js';

import { OgmRecord } from '../../utils/record';

// Only need to call this once, at the top level
setBasePath(getAssetPath(''));

// Import all required Shoelace components
import '@shoelace-style/shoelace/dist/components/icon-button/icon-button.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@shoelace-style/shoelace/dist/components/drawer/drawer.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/range/range.js';
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
  @Prop() theme: 'light' | 'dark';
  @State() record: OgmRecord;
  @State() sidebarOpen: boolean = false;
  @State() previewOpacity: number = 100;
  @State() loading: boolean = false;
  @State() resolvedTheme: 'light' | 'dark';

  private map: HTMLOgmMapElement;

  async componentWillLoad() {
    // Resolve theme without mutating @Prop()
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    this.resolvedTheme = this.theme ?? (prefersDark ? 'dark' : 'light');

    // Fetch the record if a URL is provided
    if (this.recordUrl) return await this.updateRecord();
  }

  componentDidLoad() {
    this.map = this.el.shadowRoot.querySelector('ogm-map');
  }

  // Shift the map over when the sidebar is toggled open
  @Listen('sidebarToggled')
  toggleSidebar() {
    this.sidebarOpen = !this.sidebarOpen;
    if (this.map) {
      if (this.sidebarOpen) this.map.easeMapTo({ padding: { left: 400 } });
      else this.map.easeMapTo({ padding: { left: 20 } });
    }
  }

  @Watch('recordUrl')
  async updateRecord() {
    this.record = await this.fetchRecord(this.recordUrl);
  }
  @Watch('theme')
  onThemeChanged(newTheme: 'light' | 'dark') {
    if (!newTheme) return;
    this.resolvedTheme = newTheme;
  }

  // Listen for opacity changes from the sidebar and adjust the preview layer
  @Listen('opacityChange')
  adjustPreviewOpacity(event: CustomEvent<number>) {
    this.previewOpacity = event.detail;
  }

  // Listen for map to report loading started
  @Listen('mapLoading')
  setLoadingStarted() {
    // Defer to avoid mutating state during render
    requestAnimationFrame(() => {
      this.loading = true;
    });
  }

  // Listen for map to report loading finished
  @Listen('mapIdle')
  setLoadingFinished() {
    // Defer to avoid mutating state during render
    requestAnimationFrame(() => {
      this.loading = false;
    });
  }

  // Fetch a record by URL and parse it into an OgmRecord instance
  private async fetchRecord(recordUrl: string): Promise<OgmRecord> {
    const response = await fetch(recordUrl);
    const data = await response.json();
    return new OgmRecord(data);
  }

  render() {
    const iiif = this.record?.references?.iiifManifest;
    const theme = this.resolvedTheme;
    return (
      <div class={`container sl-theme-${theme}`}>
        <ogm-menubar theme={theme} record={this.record} loading={this.loading}></ogm-menubar>
        <div class="map-container">
          <ogm-sidebar theme={theme} record={this.record} open={this.sidebarOpen}></ogm-sidebar>
          {iiif ? (
            <ogm-iiif theme={theme} manifestUrl={iiif}></ogm-iiif>
          ) : (
            <ogm-map preview-opacity={this.previewOpacity} theme={theme} record={this.record}></ogm-map>
          )}
        </div>
      </div>
    );
  }
}
