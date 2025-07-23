import { Component, Element, h, Host, Listen, Prop } from '@stencil/core';

import '@shoelace-style/shoelace/dist/components/drawer/drawer.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/tab-group/tab-group.js';
import '@shoelace-style/shoelace/dist/components/tab-panel/tab-panel.js';
import '@shoelace-style/shoelace/dist/components/tab/tab.js';

import type { OgmRecord } from '../../utils/record';
import type SlDrawer from '@shoelace-style/shoelace/dist/components/drawer/drawer.js';
import type SlTabGroup from '@shoelace-style/shoelace/dist/components/tab-group/tab-group.js';

@Component({
  tag: 'ogm-sidebar',
  styleUrl: 'ogm-sidebar.css',
  shadow: true,
})
export class OgmSidebar {
  @Element() el: HTMLElement;
  @Prop() record: OgmRecord;

  private drawer: SlDrawer;
  private tabs: SlTabGroup;

  // Find the drawer and tab group elements after the component is loaded
  componentDidLoad() {
    this.drawer = this.el.shadowRoot.querySelector('sl-drawer');
    this.tabs = this.el.shadowRoot.querySelector('sl-tab-group');
  }

  // Name of the currently active tab panel in sidebar, if one is active
  get activeTabPanel() {
    const activeTab = this.el.shadowRoot.querySelector('sl-tab[active]');
    if (activeTab) return activeTab.getAttribute('panel');
  }

  // Open/close the sidebar; if open and no active tab, show the info tab
  @Listen('sidebarToggled', { target: 'window' })
  toggleDrawer() {
    this.drawer.open = !this.drawer.open;
    if (this.drawer.open && !this.activeTabPanel) this.tabs.show('information');
  }

  render() {
    return (
      <Host>
        <sl-drawer label="Sidebar" placement="start" class="sidebar" contained no-header>
          <sl-tab-group placement="start">
            <sl-tab slot="nav" panel="information">
              <sl-icon name="info-circle-fill" label="Information"></sl-icon>
            </sl-tab>
            <sl-tab slot="nav" panel="rights">
              <sl-icon name="c-circle" label="Rights"></sl-icon>
            </sl-tab>
            <sl-tab slot="nav" panel="links">
              <sl-icon name="link-45deg" label="Links"></sl-icon>
            </sl-tab>
            <sl-tab-panel name="information">
              <div class="panel-header">About this item</div>
              <div class="panel-content">
                <ogm-metadata
                  record={this.record}
                  fieldNames={['title', 'alternativeTitles', 'description', 'resourceClass', 'resourceType', 'themes', 'subjects', 'spatial', 'issued', 'publishers']}
                />
              </div>
            </sl-tab-panel>
            <sl-tab-panel name="rights">
              <div class="panel-header">Rights</div>
              <div class="panel-content">
                <ogm-metadata record={this.record} fieldNames={['accessRights', 'license', 'rightsHolder']} />
              </div>
            </sl-tab-panel>
            <sl-tab-panel name="links">
              <div class="panel-header">Links</div>
              <div class="panel-content"></div>
            </sl-tab-panel>
          </sl-tab-group>
        </sl-drawer>
      </Host>
    );
  }
}
