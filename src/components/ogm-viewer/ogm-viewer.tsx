import { Component, Element, Host, Listen, Method, Prop, State, Watch, h } from '@stencil/core';

import OgmRecord from '../../lib/record';
import { fetchOrThrow, recordError, type PreviewError } from '../../lib/errors';
import { adoptWebAwesomeTheme, initialTheme, waScope } from '../../lib/init';
import { resolveRequest, type RequestTransform } from '../../lib/request';

@Component({
  tag: 'ogm-viewer',
  styleUrl: 'ogm-viewer.css',
  shadow: true,
})
export class OgmViewer {
  @Element() el!: HTMLElement;
  @Prop() recordUrl: string;
  @Prop() theme: 'light' | 'dark' = initialTheme(this.el);
  // A caller's own basemap for each mode, as a CARTO name (e.g. 'positron') or a URL to a MapLibre
  // style document; see MapLibreTheme.getBaseMapStyle. Undefined keeps this library's own default.
  @Prop() darkBasemap?: string;
  @Prop() lightBasemap?: string;
  @Prop() hideTitle: boolean = false;
  // Applied to the record fetch itself, and passed down to every resource built from it - see
  // Resource.requestTransform. A DOM property, like previewer on <ogm-preview>: set it before or
  // alongside recordUrl, since changing it alone doesn't refetch an already-loaded record.
  @Prop() requestTransform?: RequestTransform;
  @State() record?: OgmRecord;
  @State() error?: PreviewError;
  @State() sidebarOpen: boolean = false;
  @State() loading: boolean = false;

  private loadingCount: number = 0;
  private sidebarPadding: number = 0;

  // Prior to rendering, take the theme and fetch the record if a URL is provided
  async componentWillLoad() {
    adoptWebAwesomeTheme(this.el);
    if (this.recordUrl) return await this.updateRecord();
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

  // Listen for a preview to report loading started. Working out which previews a record even has
  // can mean reading a remote document, so that wait is counted here too.
  @Listen('previewsLoading')
  @Listen('mapLoading')
  @Listen('imageLoading')
  setLoadingStarted() {
    this.loadingCount++;
    this.loading = true;
  }

  // When all in-flight previews have loaded, clear loading state
  @Listen('previewsLoaded')
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
      const { url, init } = resolveRequest(recordUrl, 'metadata', this.requestTransform);
      const response = await fetchOrThrow(url, init);
      const data = await response.json();
      return new OgmRecord(data);
    } catch (error) {
      console.error(`Error loading record ${recordUrl}:`, error);
      this.error = recordError(error, recordUrl);
      return undefined;
    }
  }

  render() {
    return (
      <Host class={`wa-${this.theme}`}>
        <div class={`container ${waScope(this.theme)}`}>
          <ogm-menubar theme={this.theme} record={this.record} loading={this.loading} hideTitle={this.hideTitle}></ogm-menubar>
          <div class="main-container">
            <ogm-sidebar theme={this.theme} record={this.record} open={this.sidebarOpen}></ogm-sidebar>
            {this.error ? (
              <ogm-alerts theme={this.theme} error={this.error}></ogm-alerts>
            ) : (
              <ogm-previews
                theme={this.theme}
                darkBasemap={this.darkBasemap}
                lightBasemap={this.lightBasemap}
                record={this.record}
                requestTransform={this.requestTransform}
                sidebar-padding={this.sidebarPadding}
              ></ogm-previews>
            )}
          </div>
        </div>
      </Host>
    );
  }
}
