import { Component, Element, h, Host, Prop } from '@stencil/core';

import type { OgmRecord } from '../../utils/record';
import type { SlTabGroup } from '@shoelace-style/shoelace';

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

  private tabs: SlTabGroup;

  // Find the tab group element after the component is loaded
  componentDidLoad() {
    this.tabs = this.el.shadowRoot.querySelector('sl-tab-group');
  }

  // Name of the currently active tab panel in sidebar, if one is active
  get activeTabPanel() {
    const activeTab = this.el.shadowRoot.querySelector('sl-tab[active]');
    if (activeTab) return activeTab.getAttribute('panel');
  }

  // If open and no active tab, show the info tab
  componentDidUpdate() {
    if (this.open && !this.activeTabPanel) this.tabs.show('information');
  }

  render() {
    return (
      <Host class={this.theme && `sl-theme-${this.theme}`}>
        <sl-drawer label="Sidebar" placement="start" class="sidebar" contained no-header open={this.open}>
          <sl-tab-group placement="start">
            <sl-tab slot="nav" panel="information">
              <sl-icon name="info-circle-fill" label="Information"></sl-icon>
            </sl-tab>
            <sl-tab slot="nav" panel="rights">
              <sl-icon name="c-circle" label="Rights"></sl-icon>
            </sl-tab>
            <sl-tab slot="nav" panel="links">
              <sl-icon name="box-arrow-up-right" label="Links"></sl-icon>
            </sl-tab>
            <sl-tab slot="nav" panel="record">
              <sl-icon name="braces" label="Record"></sl-icon>
            </sl-tab>
            <sl-tab slot="nav" panel="settings">
              <sl-icon name="sliders" label="Settings"></sl-icon>
            </sl-tab>
            <sl-tab-panel name="information">
              <div class="panel-header">About this item</div>
              <div class="panel-content">
                <ogm-metadata
                  record={this.record}
                  fieldNames={['title', 'description', 'resourceClass', 'resourceType', 'format', 'themes', 'subjects', 'spatial', 'temporal', 'issued', 'mdModified']}
                />
              </div>
            </sl-tab-panel>
            <sl-tab-panel name="rights">
              <div class="panel-header">Rights</div>
              <div class="panel-content">
                <ogm-metadata record={this.record} fieldNames={['creators', 'publishers', 'provider', 'license', 'rights', 'accessRights', 'rightsHolder']} />
              </div>
            </sl-tab-panel>
            <sl-tab-panel name="links">
              <div class="panel-header">Links</div>
              <div class="panel-content">
                <ogm-metadata record={this.record} fieldNames={['references']} />
              </div>
            </sl-tab-panel>
            <sl-tab-panel name="record">
              <div class="panel-header">Record view</div>
              <div class="panel-content">
                <div class="record-json">{JSON.stringify(this.record?.json, null, 2)}</div>
              </div>
            </sl-tab-panel>
            <sl-tab-panel name="settings">
              <div class="panel-header">Settings</div>
              <div class="panel-content">
                <ogm-settings record={this.record} />
              </div>
            </sl-tab-panel>
          </sl-tab-group>
        </sl-drawer>
      </Host>
    );
  }
}
