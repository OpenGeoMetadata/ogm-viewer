import { Component, Event, EventEmitter, h, Host, Prop, State, Watch } from '@stencil/core';

import '@awesome.me/webawesome/dist/components/tab-group/tab-group.js';
import '@awesome.me/webawesome/dist/components/tab-panel/tab-panel.js';
import '@awesome.me/webawesome/dist/components/tab/tab.js';

import type OgmRecord from '../../lib/record';
import { themePreference, waScope, webAwesomeStylesheet } from '../../lib/init';
import { resourcesFor } from '../../lib/resources/factory';
import { previewersForResources, type AnyPreviewer } from '../../lib/previewers/factory';

@Component({
  tag: 'ogm-previews',
  styleUrl: 'ogm-previews.css',
  shadow: true,
})
export class OgmPreviews {
  @Prop() theme: 'light' | 'dark' = themePreference();
  @Prop() record: OgmRecord;
  @Prop() sidebarPadding: number;
  @State() previewers: AnyPreviewer[] = [];
  @Event() previewsLoading: EventEmitter<void>;
  @Event() previewsLoaded: EventEmitter<void>;

  // Which build of the list is the current one. A record can change while the previous one's
  // previews are still being worked out, and the answer that arrives last is not necessarily the
  // one still wanted.
  private pending = 0;

  // @Watch only fires on changes, so the record we were rendered with is handled here. Returning
  // the promise makes Stencil hold the first render until the tabs are known, so the tab strip is
  // never painted empty and then filled in.
  componentWillLoad() {
    return this.buildPreviewers(this.record);
  }

  @Watch('record')
  protected async onRecordChange(record?: OgmRecord) {
    await this.buildPreviewers(record);
  }

  // Every preview this record offers, one per tab
  private async buildPreviewers(record?: OgmRecord) {
    const build = ++this.pending;
    if (!record) {
      this.previewers = [];
      return;
    }

    this.previewsLoading.emit();
    try {
      const previewers = await previewersForResources(resourcesFor(record));
      // A newer record started building while this one was waiting; that one's answer is the keeper
      if (build === this.pending) this.previewers = previewers;
    } finally {
      // Always paired with the emit above, even when superseded: ogm-viewer counts these
      this.previewsLoaded.emit();
    }
  }

  // Render as tabs for switching between previews
  render() {
    if (!this.record || !this.previewers.length) return;

    return (
      <Host class={waScope(this.theme)}>
        <link rel="stylesheet" href={webAwesomeStylesheet()} />
        <wa-tab-group>
          {this.previewers.map((previewer, idx) => (
            <wa-tab key={idx} panel={previewer.previewId}>
              {previewer.label()}
            </wa-tab>
          ))}
          {this.previewers.map((previewer, idx) => (
            <wa-tab-panel key={idx} name={previewer.previewId} active={idx === 0}>
              <ogm-preview theme={this.theme} previewer={previewer} sidebar-padding={this.sidebarPadding}></ogm-preview>
            </wa-tab-panel>
          ))}
        </wa-tab-group>
      </Host>
    );
  }
}
