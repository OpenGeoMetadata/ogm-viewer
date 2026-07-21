import { Component, Host, Prop, h } from '@stencil/core';

import type { PreviewError } from '../../lib/errors';

// Renders a single preview error, centered and filling its container. Used in place of a failed
// preview (inside <ogm-preview>) or in place of the previews entirely (when the record fails to load).
@Component({
  tag: 'ogm-alerts',
  styleUrl: 'ogm-alerts.css',
  shadow: true,
})
export class OgmAlerts {
  @Prop() theme: 'light' | 'dark';
  @Prop() error?: PreviewError;

  render() {
    if (!this.error) return null;

    return (
      <Host class={this.theme && `wa-${this.theme}`}>
        <div class="alerts" role="alert" aria-live="assertive">
          <wa-callout variant="danger" appearance="filled-outlined" class="alert">
            <wa-icon slot="icon" name="exclamation-triangle-fill" canvas="auto"></wa-icon>
            <div class="content">
              <strong class="title">{this.error.title}</strong>
              <div class="message">{this.error.message}</div>
              {this.error.url && (
                <div class="url" title={this.error.url}>
                  {this.error.url}
                </div>
              )}
            </div>
          </wa-callout>
        </div>
      </Host>
    );
  }
}
