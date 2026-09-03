import { Component, Element, Event, EventEmitter, Host, Method, Prop, State, Watch, h } from '@stencil/core';

import '@awesome.me/webawesome/dist/components/tab-group/tab-group.js';
import '@awesome.me/webawesome/dist/components/tab-panel/tab-panel.js';
import '@awesome.me/webawesome/dist/components/tab/tab.js';

import type OgmRecord from '../../lib/record';
import { findElement } from '../../lib/elements';
import type { ContentSearchAnnotation } from '../../lib/content-search';
import { adoptWebAwesomeTheme, initialTheme, waScope } from '../../lib/init';
import { resourcesFor } from '../../lib/resources/factory';
import { previewersForResources, type AnyPreviewer } from '../../lib/previewers/factory';
import type { RequestTransform } from '../../lib/request';
import type WaTabGroup from '@awesome.me/webawesome/dist/components/tab-group/tab-group.js';

type AnnotationPreview = HTMLElement & {
  componentOnReady?(): Promise<unknown>;
  focusAnnotation(annotation: ContentSearchAnnotation): Promise<boolean>;
};

@Component({
  tag: 'ogm-previews',
  styleUrl: 'ogm-previews.css',
  shadow: true,
})
export class OgmPreviews {
  @Element() el!: HTMLElement;
  @Prop() theme: 'light' | 'dark' = initialTheme(this.el);
  // A caller's own basemap for each mode, as a URL to a MapLibre style document; see
  // MapLibreTheme.getBaseMapStyle. Undefined keeps this library's own default.
  @Prop() darkBasemap?: string;
  @Prop() lightBasemap?: string;
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
    adoptWebAwesomeTheme(this.el);
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

  /** Open the image preview and focus a IIIF Content Search annotation in it. */
  @Method()
  async focusAnnotation(annotation: ContentSearchAnnotation): Promise<boolean> {
    const index = this.tabs.findIndex(previewer => previewer.renderer === 'image');
    if (index < 0) return false;

    const group = findElement(this.el, 'wa-tab-group') as WaTabGroup | undefined;
    if (!group) return false;
    group.active = this.tabs[index].previewId;

    const previews = Array.from(this.el.shadowRoot?.querySelectorAll('ogm-preview') ?? []) as unknown as AnnotationPreview[];
    const preview = previews[index];
    if (!preview) return false;
    await preview.componentOnReady?.();
    return preview.focusAnnotation(annotation);
  }

  // Render as tabs for switching between previews.
  //
  // Keyed by which preview each element draws, not by where it sits. Position is the wrong identity
  // twice over: a tab and its panel are siblings inside the group, so numbering both from zero gave
  // it two children under every key and the diff went on to reuse a tab where a panel belonged. And
  // wa-tab-group tracks which tab is active itself, in a property no render of ours writes, so a
  // group left standing across a change of previews keeps pointing at whichever tab the user had
  // picked - the third one of a record that now offers two. Keying the group by the whole set
  // replaces it outright when the previews change, which is the only way to clear that.
  //
  // The tab group carries the Web Awesome scope as well as the Host, since the stylesheet linked here
  // establishes the palette with plain class selectors and those never match their own shadow host.
  // Everything the group draws - the tabs, their panels - reads its colors from it.
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
              ></ogm-preview>
            </wa-tab-panel>
          ))}
        </wa-tab-group>
      </Host>
    );
  }
}
