import { Component, Element, Host, Listen, Prop, State, Watch, h } from '@stencil/core';

import { adoptWebAwesomeTheme, initialTheme, waScope } from '../../lib/init';
import type { AnyPreviewer } from '../../lib/previewers/factory';
import type { PreviewError } from '../../lib/errors';
import type { References } from '../../lib/references';

@Component({
  tag: 'ogm-preview',
  styleUrl: 'ogm-preview.css',
  shadow: true,
})
export class OgmPreview {
  @Element() el!: HTMLElement;
  @Prop() theme: 'light' | 'dark' = initialTheme(this.el);
  @Prop() darkBasemap?: string;
  @Prop() lightBasemap?: string;
  @Prop() previewer: AnyPreviewer;
  @Prop() sidebarPadding: number;
  @Prop() cooperativeGestures: boolean = true;
  @Prop() references?: References;
  @State() error?: PreviewError;

  componentWillLoad() {
    adoptWebAwesomeTheme(this.el);
  }

  @Watch('previewer')
  resetError() {
    const needsMap = this.previewer && this.previewer.renderer !== 'image';
    if (this.error?.fatal && needsMap) return;
    this.error = undefined;
  }

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

  render() {
    return (
      <Host class={waScope(this.theme)}>
        {this.renderPreview()}
        {this.error && <ogm-alerts theme={this.theme} error={this.error}></ogm-alerts>}
      </Host>
    );
  }
}
