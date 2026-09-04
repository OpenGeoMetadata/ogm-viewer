import { Component, Element, Host, Listen, Prop, State, Watch, h } from '@stencil/core';

import { adoptWebAwesomeTheme, initialTheme, waScope } from '../../lib/init';
import type { AnyPreviewer } from '../../lib/previewers/factory';
import type { PreviewError } from '../../lib/errors';
import type { References } from '../../lib/references';

// Wraps a single preview and surfaces error(s) during it.
@Component({
  tag: 'ogm-preview',
  styleUrl: 'ogm-preview.css',
  shadow: true,
})
export class OgmPreview {
  @Element() el!: HTMLElement;
  @Prop() theme: 'light' | 'dark' = initialTheme(this.el);
  // A caller's own basemap for each mode, as a URL to a MapLibre style document; see
  // MapLibreTheme.getBaseMapStyle. Undefined keeps this library's own default. Only reaches the map
  // preview below - an image preview has no basemap to apply it to.
  @Prop() darkBasemap?: string;
  @Prop() lightBasemap?: string;
  @Prop() previewer: AnyPreviewer;
  @Prop() sidebarPadding: number;
  @Prop() cooperativeGestures: boolean = true;
  @Prop() references?: References;
  @State() error?: PreviewError;

  // Before the first frame, so nothing paints unstyled
  componentWillLoad() {
    adoptWebAwesomeTheme(this.el);
  }

  // A new preview is a fresh load attempt, so clear any error left over from the previous one.
  @Watch('previewer')
  resetError() {
    this.error = undefined;
  }

  // Catch the load error emitted by the child map/image and show it in place of the preview.
  @Listen('previewError')
  handlePreviewError(event: CustomEvent<PreviewError>) {
    event.stopPropagation();
    this.error = event.detail;
  }

  private renderPreview() {
    if (!this.previewer) return;
    if (this.previewer.renderer === 'image') {
      return <ogm-image theme={this.theme} previewer={this.previewer} padding={this.sidebarPadding}></ogm-image>;
    }
    return (
      <ogm-map
        theme={this.theme}
        darkBasemap={this.darkBasemap}
        lightBasemap={this.lightBasemap}
        previewer={this.previewer}
        padding={this.sidebarPadding}
        cooperativeGestures={this.cooperativeGestures}
        references={this.references}
      ></ogm-map>
    );
  }

  // No scope on an element of our own, unlike the components below: nothing we draw reads a color -
  // each of them draws its own contents and establishes its own scope for them. The link and the
  // Host's classes still matter, though. The classes are what the parent's stylesheet matches when
  // we're nested, and the link is what matches them on the children rendered here - which is how
  // <ogm-alerts>'s :host gets the surface color it fills a failed preview with.
  render() {
    return (
      <Host class={waScope(this.theme)}>
        {this.renderPreview()}
        {this.error && <ogm-alerts theme={this.theme} error={this.error}></ogm-alerts>}
      </Host>
    );
  }
}
