import { Component, Prop, EventEmitter, h, Watch, Event } from '@stencil/core';
import type { OgmRecord } from '../../utils/record';

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

  @Watch('loading')
  handleLoadingChange(newValue: boolean) {
    console.log(`Loading state changed: ${newValue}`);
  }

  render() {
    return (
      <div class={`menubar ${this.theme && `sl-theme-${this.theme}`}`}>
        <sl-icon-button name="list" label="Open sidebar" class="menu-button" onclick={this.sidebarToggled.emit}></sl-icon-button>
        {this.record?.restricted && (
          <sl-tooltip content="Restricted access">
            <sl-icon name="lock-fill" label="Restricted access" class="restricted-icon"></sl-icon>
          </sl-tooltip>
        )}
        <div class="title">{this.record?.title}</div>
        {this.loading && <sl-spinner class="loading-spinner"></sl-spinner>}
      </div>
    );
  }
}
