import { Component, Event, EventEmitter, h, Host, Prop, State, Watch } from '@stencil/core';

import '@awesome.me/webawesome/dist/components/tab-group/tab-group.js';
import '@awesome.me/webawesome/dist/components/tab-panel/tab-panel.js';
import '@awesome.me/webawesome/dist/components/tab/tab.js';

import type OgmRecord from '../../lib/record';
import { themePreference, waScope, webAwesomeStylesheet } from '../../lib/init';
import { resourcesFor } from '../../lib/resources/factory';
import { previewersForResources, type AnyPreviewer } from '../../lib/previewers/factory';
import type { RequestTransform } from '../../lib/request';

@Component({
  tag: 'ogm-previews',
  styleUrl: 'ogm-previews.css',
  shadow: true,
})
export class OgmPreviews {
  @Prop() theme: 'light' | 'dark' = themePreference();
  @Prop() record?: OgmRecord;
  // Previews to show, for an application that builds its own rather than handing over a record - the
  // tab strip is worth having either way. Takes the place of `record`, which is then not read at all.
  // A DOM property, like `record`: neither survives being written as an attribute.
  @Prop() previewers?: AnyPreviewer[];
  // Passed to resourcesFor() when building this record's previews; see Resource.requestTransform.
  // Previewers handed over directly carry their own, by way of the resources they were built from.
  @Prop() requestTransform?: RequestTransform;
  @Prop() sidebarPadding: number;
  @State() private recordPreviewers: AnyPreviewer[] = [];
  @Event() previewsLoading: EventEmitter<void>;
  @Event() previewsLoaded: EventEmitter<void>;

  // Which build of the list is the current one. A record can change while the previous one's
  // previews are still being worked out, and the answer that arrives last is not necessarily the
  // one still wanted.
  private pending = 0;

  // Every preview to show, one per tab: the ones we were handed, or else the ones this record turned
  // out to offer.
  private get tabs(): AnyPreviewer[] {
    return this.previewers ?? this.recordPreviewers;
  }

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

  // Every preview this record offers, one per tab. Skipped entirely when previews were handed to us:
  // there is nothing for a record to add, and the work would only be thrown away.
  private async buildPreviewers(record?: OgmRecord) {
    const build = ++this.pending;
    if (!record || this.previewers) {
      this.recordPreviewers = [];
      return;
    }

    this.previewsLoading.emit();
    try {
      const previewers = await previewersForResources(resourcesFor(record, this.requestTransform));
      // A newer record started building while this one was waiting; that one's answer is the keeper
      if (build === this.pending) this.recordPreviewers = previewers;
    } finally {
      // Always paired with the emit above, even when superseded: ogm-viewer counts these
      this.previewsLoaded.emit();
    }
  }

  // Render as tabs for switching between previews
  render() {
    const tabs = this.tabs;
    if (!tabs.length) return;

    return (
      <Host class={waScope(this.theme)}>
        <link rel="stylesheet" href={webAwesomeStylesheet()} />
        <wa-tab-group>
          {tabs.map((previewer, idx) => (
            <wa-tab key={idx} panel={previewer.previewId}>
              {previewer.label()}
            </wa-tab>
          ))}
          {tabs.map((previewer, idx) => (
            <wa-tab-panel key={idx} name={previewer.previewId} active={idx === 0}>
              <ogm-preview theme={this.theme} previewer={previewer} sidebar-padding={this.sidebarPadding}></ogm-preview>
            </wa-tab-panel>
          ))}
        </wa-tab-group>
      </Host>
    );
  }
}
