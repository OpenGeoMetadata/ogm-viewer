import { Component, Element, h, Host, Prop } from '@stencil/core';

import { getElement } from '../../lib/elements';
import type { OgmRecord } from '../../lib/record';
import type WaTabGroup from '@awesome.me/webawesome/dist/components/tab-group/tab-group.js';

@Component({
  tag: 'ogm-sidebar',
  styleUrl: 'ogm-sidebar.css',
  shadow: true,
})
export class OgmSidebar {
  @Element() el: HTMLElement;
  @Prop() record: OgmRecord;
  @Prop() theme: 'light' | 'dark';
  @Prop() open: boolean = false;

  private tabs: WaTabGroup;

  // Find the tab group element after the component is loaded
  componentDidLoad() {
    this.tabs = getElement(this.el, 'wa-tab-group') as WaTabGroup;
  }

  // Name of the currently active tab panel in sidebar, if one is active
  get activeTabPanel() {
    return this.tabs?.active || undefined;
  }

  // If open and no active tab, show the info tab
  componentDidUpdate() {
    if (this.open && !this.activeTabPanel) this.tabs.active = 'information';
  }

  render() {
    return (
      <Host class={this.theme && `wa-${this.theme}`}>
        {/* Contained sliding panel; wa-drawer always renders as a full-viewport modal, which doesn't suit an embeddable widget */}
        <div class={`sidebar ${this.open ? 'open' : ''}`} role="region" aria-label="Sidebar" aria-hidden={this.open ? 'false' : 'true'}>
          <wa-tab-group placement="start">
            <wa-tab slot="nav" panel="information">
              <wa-icon name="info-circle-fill" label="Information" canvas="auto"></wa-icon>
            </wa-tab>
            <wa-tab slot="nav" panel="rights">
              <wa-icon name="c-circle" label="Rights" canvas="auto"></wa-icon>
            </wa-tab>
            <wa-tab slot="nav" panel="links">
              <wa-icon name="box-arrow-up-right" label="Links" canvas="auto"></wa-icon>
            </wa-tab>
            <wa-tab slot="nav" panel="record">
              <wa-icon name="braces" label="Record" canvas="auto"></wa-icon>
            </wa-tab>
            <wa-tab slot="nav" panel="settings">
              <wa-icon name="sliders" label="Settings" canvas="auto"></wa-icon>
            </wa-tab>
            <wa-tab-panel name="information">
              <div class="panel-header">About this item</div>
              <div class="panel-content">
                <ogm-metadata
                  record={this.record}
                  fieldNames={[
                    'title',
                    'description',
                    'creators',
                    'publishers',
                    'resourceClass',
                    'resourceType',
                    'format',
                    'themes',
                    'subjects',
                    'spatial',
                    'temporal',
                    'issued',
                    'mdModified',
                  ]}
                />
              </div>
            </wa-tab-panel>
            <wa-tab-panel name="rights">
              <div class="panel-header">Access conditions</div>
              <div class="panel-content">
                <ogm-metadata record={this.record} fieldNames={['provider', 'license', 'rights', 'rightsHolder']} />
              </div>
            </wa-tab-panel>
            <wa-tab-panel name="links">
              <div class="panel-header">Links</div>
              <div class="panel-content">
                <ogm-metadata record={this.record} fieldNames={['references']} />
              </div>
            </wa-tab-panel>
            <wa-tab-panel name="record">
              <div class="panel-header">Record view</div>
              <div class="panel-content">
                <div class="record-json">{JSON.stringify(this.record?.json, null, 2)}</div>
              </div>
            </wa-tab-panel>
            <wa-tab-panel name="settings">
              <div class="panel-header">Settings</div>
              <div class="panel-content">
                <ogm-settings record={this.record} />
              </div>
            </wa-tab-panel>
          </wa-tab-group>
        </div>
      </Host>
    );
  }
}
