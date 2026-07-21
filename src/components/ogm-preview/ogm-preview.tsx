import { Component, h, Host, Listen, Prop, State, Watch } from '@stencil/core';

import IIIFSource from '../../lib/sources/iiif';
import type Source from '../../lib/sources/source';
import type { PreviewError } from '../../lib/errors';

// Wraps a single source's preview and surfaces error(s) during the preview.
@Component({
  tag: 'ogm-preview',
  styleUrl: 'ogm-preview.css',
  shadow: true,
})
export class OgmPreview {
  @Prop() theme: 'light' | 'dark';
  @Prop() source: Source;
  @Prop() previewOpacity: number;
  @Prop() sidebarPadding: number;
  @State() error?: PreviewError;

  // A new source is a fresh load attempt, so clear any error left over from the previous one.
  @Watch('source')
  resetError() {
    this.error = undefined;
  }

  // Catch the load error emitted by the child map/image and show it in place of the preview.
  @Listen('previewError')
  handlePreviewError(event: CustomEvent<PreviewError>) {
    event.stopPropagation();
    this.error = event.detail;
  }

  // IIIF sources use the image viewer; every other source type is previewed on the map.
  private renderPreview() {
    if (this.source instanceof IIIFSource) {
      return <ogm-image theme={this.theme} source={this.source} padding={this.sidebarPadding}></ogm-image>;
    }
    return <ogm-map preview-opacity={this.previewOpacity} theme={this.theme} source={this.source} padding={this.sidebarPadding}></ogm-map>;
  }

  render() {
    return (
      <Host>
        {this.renderPreview()}
        {this.error && <ogm-alerts theme={this.theme} error={this.error}></ogm-alerts>}
      </Host>
    );
  }
}
