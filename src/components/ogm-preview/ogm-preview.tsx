import { Component, h, Host, Listen, Prop, State, Watch } from '@stencil/core';

import { themePreference, waScope, webAwesomeStylesheet } from '../../lib/init';
import type { AnyPreviewer } from '../../lib/previewers/factory';
import type { PreviewError } from '../../lib/errors';

// Wraps a single preview and surfaces error(s) during it.
@Component({
  tag: 'ogm-preview',
  styleUrl: 'ogm-preview.css',
  shadow: true,
})
export class OgmPreview {
  @Prop() theme: 'light' | 'dark' = themePreference();
  @Prop() previewer: AnyPreviewer;
  @Prop() sidebarPadding: number;
  @State() error?: PreviewError;

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
    return <ogm-map theme={this.theme} previewer={this.previewer} padding={this.sidebarPadding}></ogm-map>;
  }

  render() {
    return (
      <Host class={waScope(this.theme)}>
        <link rel="stylesheet" href={webAwesomeStylesheet()} />
        {this.renderPreview()}
        {this.error && <ogm-alerts theme={this.theme} error={this.error}></ogm-alerts>}
      </Host>
    );
  }
}
