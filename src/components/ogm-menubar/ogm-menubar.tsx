import { Component, Prop, EventEmitter, h, Event } from '@stencil/core';
import type OgmRecord from '../../lib/record';

@Component({
  tag: 'ogm-menubar',
  styleUrl: 'ogm-menubar.css',
  shadow: true,
})
export class OgmMenubar {
  @Prop() record: OgmRecord;
  @Prop() theme: 'light' | 'dark';
  @Event() sidebarToggled: EventEmitter;
  @Prop() loading: boolean = false;

  render() {
    return (
      <div class={`menubar ${this.theme && `wa-${this.theme}`}`}>
        <wa-button appearance="plain" class="menu-button" onclick={this.sidebarToggled.emit}>
          <wa-icon name="list" label="Open sidebar" canvas="auto"></wa-icon>
        </wa-button>
        {this.record?.restricted && (
          <>
            <wa-tooltip for="restricted-icon">Restricted access</wa-tooltip>
            <wa-icon id="restricted-icon" name="lock-fill" label="Restricted access" class="restricted-icon" canvas="auto"></wa-icon>
          </>
        )}
        <div class="title">{this.record?.title}</div>
        {this.loading && <wa-spinner class="loading-spinner"></wa-spinner>}
      </div>
    );
  }
}
