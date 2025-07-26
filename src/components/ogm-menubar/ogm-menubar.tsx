import { Component, Prop, EventEmitter, h, Event } from '@stencil/core';
import type { OgmRecord } from '../../utils/record';

@Component({
  tag: 'ogm-menubar',
  styleUrl: 'ogm-menubar.css',
  shadow: true,
})
export class OgmMenubar {
  @Prop() record: OgmRecord;
  @Event() sidebarToggled: EventEmitter;
  @Prop() loading: boolean = false;

  render() {
    return (
      <div class="menubar">
        <sl-icon-button name="list" label="Open sidebar" class="menu-button" onclick={this.sidebarToggled.emit}></sl-icon-button>
        <div class="title">{this.record?.title}</div>
        {this.loading && <sl-spinner class="loading-spinner"></sl-spinner>}
      </div>
    );
  }
}
