import { Component, Element, Host, Prop, h } from '@stencil/core';

import '@awesome.me/webawesome/dist/components/callout/callout.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';

import { adoptWebAwesomeTheme, initialTheme, waScope } from '../../lib/init';
import type { PreviewError } from '../../lib/errors';

@Component({
  tag: 'ogm-alerts',
  styleUrl: 'ogm-alerts.css',
  shadow: true,
})
export class OgmAlerts {
  @Element() el!: HTMLElement;
  @Prop() theme: 'light' | 'dark' = initialTheme(this.el);
  @Prop() error?: PreviewError;

  componentWillLoad() {
    adoptWebAwesomeTheme(this.el);
  }

  // The theme's class selectors match an inner scope, not its own shadow host.
  render() {
    if (!this.error) return null;

    return (
      <Host class={waScope(this.theme)}>
        <div class={`alerts ${waScope(this.theme)}`} role="alert" aria-live="assertive">
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
