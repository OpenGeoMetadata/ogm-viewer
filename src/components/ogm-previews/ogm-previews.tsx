import { Component, Element, Event, EventEmitter, Host, Prop, State, Watch, h } from '@stencil/core';

import '@awesome.me/webawesome/dist/components/tab-group/tab-group.js';
import '@awesome.me/webawesome/dist/components/tab-panel/tab-panel.js';
import '@awesome.me/webawesome/dist/components/tab/tab.js';

import type OgmRecord from '../../lib/record';
import { adoptWebAwesomeTheme, initialTheme, waScope } from '../../lib/init';
import { resourcesFor } from '../../lib/resources/factory';
import { previewersForResources, type AnyPreviewer } from '../../lib/previewers/factory';
import type { RequestTransform } from '../../lib/request';
import { defaultBeforeId } from '../../lib/themes/maplibre';

@Component({
  tag: 'ogm-previews',
  styleUrl: 'ogm-previews.css',
  shadow: true,
})
export class OgmPreviews {
  @Element() el!: HTMLElement;
  @Prop() theme: 'light' | 'dark' = initialTheme(this.el);
  @Prop() darkBasemap?: string;
  @Prop() lightBasemap?: string;
  @Prop() record?: OgmRecord;
  @Prop() previewers?: AnyPreviewer[];
  @Prop() requestTransform?: RequestTransform;
  /** Undefined uses the default label layer; an empty string places previews above the basemap. */
  @Prop() beforeId?: string;
  @Prop() sidebarPadding: number;
  @State() private recordPreviewers: AnyPreviewer[] = [];
  @Event() previewsLoading: EventEmitter<void>;
  @Event() previewsLoaded: EventEmitter<void>;

  // Ignore preview lists built for a record that has since changed.
  private pending = 0;

  private get tabs(): AnyPreviewer[] {
    return this.previewers ?? this.recordPreviewers;
  }

  // Return the promise so the first render waits until the preview tabs are known.
  componentWillLoad() {
    adoptWebAwesomeTheme(this.el);
    return this.buildPreviewers(this.record);
  }

  @Watch('record')
  protected async onRecordChange(record?: OgmRecord) {
    await this.buildPreviewers(record);
  }

  private async buildPreviewers(record?: OgmRecord) {
    const build = ++this.pending;
    if (!record || this.previewers) {
      this.recordPreviewers = [];
      return;
    }

    this.previewsLoading.emit();
    try {
      const previewers = await previewersForResources(resourcesFor(record, this.requestTransform));
      this.applyBeforeId(previewers, this.beforeId);
      if (build === this.pending) this.recordPreviewers = previewers;
    } finally {
      this.previewsLoaded.emit();
    }
  }

  @Watch('beforeId')
  protected onBeforeIdChange(beforeId?: string) {
    this.applyBeforeId(this.recordPreviewers, beforeId ?? defaultBeforeId);
  }

  private applyBeforeId(previewers: AnyPreviewer[], beforeId?: string) {
    if (beforeId === undefined) return;
    for (const previewer of previewers) if (previewer.renderer === 'map') previewer.beforeId = beforeId;
  }

  // Key the group by its previews so a new set resets the internally managed active tab.
  render() {
    const tabs = this.tabs;
    if (!tabs.length) return;

    return (
      <Host class={waScope(this.theme)}>
        <wa-tab-group class={waScope(this.theme)} key={tabs.map(previewer => previewer.previewId).join()}>
          {tabs.map(previewer => (
            <wa-tab key={`tab-${previewer.previewId}`} panel={previewer.previewId}>
              {previewer.label()}
            </wa-tab>
          ))}
          {tabs.map((previewer, idx) => (
            <wa-tab-panel key={`panel-${previewer.previewId}`} name={previewer.previewId} active={idx === 0}>
              <ogm-preview
                theme={this.theme}
                darkBasemap={this.darkBasemap}
                lightBasemap={this.lightBasemap}
                previewer={previewer}
                sidebar-padding={this.sidebarPadding}
                references={this.record?.references}
              ></ogm-preview>
            </wa-tab-panel>
          ))}
        </wa-tab-group>
      </Host>
    );
  }
}
