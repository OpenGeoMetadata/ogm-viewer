import { Component, Prop, EventEmitter, h, Event } from '@stencil/core';
import type { OgmRecord } from '../../utils/record';

import _SlIconButton from '@shoelace-style/shoelace/dist/components/icon-button/icon-button.component.js';
import _SlTooltip from '@shoelace-style/shoelace/dist/components/tooltip/tooltip.component.js';

@Component({
  tag: 'ogm-menubar',
  styleUrl: 'ogm-menubar.css',
  shadow: true,
})
export class OgmMenubar {
  @Prop() record: OgmRecord;
  @Event() sidebarToggled: EventEmitter;

  // Don't render anything if no record is loaded
  render() {
    if (!this.record) return;
    return (
      <div class="menubar">
        <sl-tooltip content="Open sidebar">
          <sl-icon-button name="list" label="Open sidebar" class="menu-button" onclick={this.sidebarToggled.emit}></sl-icon-button>
        </sl-tooltip>
        <div class="title">{this.record.title}</div>
      </div>
    );
  }
}
