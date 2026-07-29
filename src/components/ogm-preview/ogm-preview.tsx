import { Component, h, Host, Listen, Prop, State, Watch } from '@stencil/core';

import IIIFResource from '../../lib/resources/iiif';
import type Resource from '../../lib/resources/resource';
import type { PreviewError } from '../../lib/errors';

// Wraps a single resource's preview and surfaces error(s) during the preview.
@Component({
  tag: 'ogm-preview',
  styleUrl: 'ogm-preview.css',
  shadow: true,
})
export class OgmPreview {
  @Prop() theme: 'light' | 'dark';
  @Prop() previewResource: Resource;
  @Prop() sidebarPadding: number;
  @State() error?: PreviewError;

  // A new resource is a fresh load attempt, so clear any error left over from the previous one.
  @Watch('previewResource')
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
    if (this.previewResource instanceof IIIFResource) {
      return <ogm-image theme={this.theme} previewResource={this.previewResource} padding={this.sidebarPadding}></ogm-image>;
    }
    return <ogm-map theme={this.theme} previewResource={this.previewResource} padding={this.sidebarPadding}></ogm-map>;
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
