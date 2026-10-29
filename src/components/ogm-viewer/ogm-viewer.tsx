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
  @Prop() recordUrl?: string;
  @Prop() theme: 'light' | 'dark' = initialTheme(this.el);
  @Prop() darkBasemap?: string;
  @Prop() lightBasemap?: string;
  @Prop() beforeId?: string;
  @Prop() hideTitle: boolean = false;
  /** Set before recordUrl; changing this alone does not refetch the current record. */
  @Prop() requestTransform?: RequestTransform;
  @State() record?: OgmRecord;
  @State() error?: PreviewError;
  @State() sidebarOpen: boolean = false;
  @State() loading: boolean = false;

  private loadingCount: number = 0;
  private sidebarPadding: number = 0;

  async componentWillLoad() {
    adoptWebAwesomeTheme(this.el);
    if (this.recordUrl) return await this.updateRecord();
  }

  @Listen('sidebarToggled')
  toggleSidebar() {
    this.sidebarOpen = !this.sidebarOpen;
    this.sidebarPadding = this.sidebarOpen ? 400 : 0;
  }

  @Watch('recordUrl')
  async updateRecord() {
    this.record = await this.fetchRecord(this.recordUrl);
  }

  @Method()
  async loadRecord(record: OgmRecord) {
    this.error = undefined;
    this.record = record;
  }

  @Listen('previewsLoading')
  @Listen('mapLoading')
  @Listen('imageLoading')
  setLoadingStarted() {
    this.loadingCount++;
    this.loading = true;
  }

  @Listen('previewsLoaded')
  @Listen('mapIdle')
  @Listen('imageLoaded')
  setLoadingFinished() {
    this.loadingCount = Math.max(0, this.loadingCount - 1);
    this.loading = this.loadingCount > 0;
  }

  @Watch('record')
  resetLoading() {
    this.loadingCount = 0;
    this.loading = false;
  }

  private async fetchRecord(recordUrl?: string): Promise<OgmRecord | undefined> {
    this.error = undefined;
    if (!recordUrl) return undefined;
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
            <ogm-sidebar theme={this.theme} record={this.record} open={this.sidebarOpen} requestTransform={this.requestTransform}></ogm-sidebar>
            {this.error ? (
              <ogm-alerts theme={this.theme} error={this.error}></ogm-alerts>
            ) : (
              <ogm-previews
                theme={this.theme}
                darkBasemap={this.darkBasemap}
                lightBasemap={this.lightBasemap}
                beforeId={this.beforeId}
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
