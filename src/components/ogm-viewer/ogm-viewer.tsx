import { Component, Element, Prop, Watch, State, Listen, h, getAssetPath } from '@stencil/core';
import { setBasePath } from '@shoelace-style/shoelace/dist/utilities/base-path.js';
import maplibregl from 'maplibre-gl';
import { cogProtocol } from '@geomatico/maplibre-cog-protocol';

import { OgmRecord } from '../../utils/record';
import { getPreviewLayer } from '../../utils/sources';

// Only need to call this once, at the top level
setBasePath(getAssetPath(''));

// Add support for COG protocol
maplibregl.addProtocol('cog', cogProtocol);

// Import all required Shoelace components
import '@shoelace-style/shoelace/dist/components/icon-button/icon-button.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@shoelace-style/shoelace/dist/components/drawer/drawer.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/range/range.js';
import '@shoelace-style/shoelace/dist/components/tab-group/tab-group.js';
import '@shoelace-style/shoelace/dist/components/tab-panel/tab-panel.js';
import '@shoelace-style/shoelace/dist/components/tab/tab.js';

@Component({
  tag: 'ogm-viewer',
  styleUrl: 'ogm-viewer.css',
  shadow: true,
})
export class OgmViewer {
  @Element() el: HTMLElement;
  @Prop() recordUrl: string;
  @State() record: OgmRecord;
  @State() sidebarOpen: boolean = false;
  @State() loading: boolean = false;

  private map: maplibregl.Map;
  private previewId: string;

  async componentWillLoad() {
    if (this.recordUrl) return await this.updateRecord();
  }

  componentDidLoad() {
    this.map = new maplibregl.Map({
      container: this.el.shadowRoot.getElementById('map'),
      style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
      center: [0, 0],
      zoom: 1,
    });

    this.map.addControl(new maplibregl.NavigationControl());
    this.map.addControl(new maplibregl.FullscreenControl());
    this.map.addControl(new maplibregl.GlobeControl());

    this.map.once('load', this.addPreview.bind(this));
    this.map.on('idle', () => (this.loading = false));
  }

  // Sidebar emits this event when menu button is clicked
  @Listen('sidebarToggled')
  _toggleSidebar() {
    this.sidebarOpen = !this.sidebarOpen;

    // Shift the map over when the sidebar is open
    if (this.sidebarOpen) this.map.easeTo({ padding: { left: 400 } });
    else this.map.easeTo({ padding: { left: 20 } });
  }

  @Watch('recordUrl')
  private async updateRecord() {
    if (this.recordUrl) this.record = await this.fetchRecord(this.recordUrl);
  }

  @Watch('record')
  addPreview() {
    if (!this.record || !this.map) return;
    this.loading = true;

    const bounds = this.record.getBounds();

    this.clearPreview();

    const previewLayer = getPreviewLayer(this.record);
    if (previewLayer) {
      this.previewId = previewLayer.id;
      this.map.addLayer(previewLayer);
    }

    this.map.fitBounds(bounds, { padding: 20 });
  }

  @Listen('opacityChange')
  adjustPreviewOpacity(event: CustomEvent<number>) {
    const opacity = event.detail;
    if (!this.previewId || !this.map) return;
    const layer = this.map.getLayer(this.previewId);
    if (layer) {
      if (layer.type === 'raster') {
        this.map.setPaintProperty(this.previewId, 'raster-opacity', opacity / 100);
      } else if (layer.type === 'fill') {
        this.map.setPaintProperty(this.previewId, 'fill-opacity', opacity / 100);
      } else if (layer.type === 'line') {
        this.map.setPaintProperty(this.previewId, 'line-opacity', opacity / 100);
      } else if (layer.type === 'circle') {
        this.map.setPaintProperty(this.previewId, 'circle-opacity', opacity / 100);
      }
    }
  }

  // Remove the preview layer and source from the map
  clearPreview() {
    if (!this.previewId) return;
    this.map.removeLayer(this.previewId);
    this.map.removeSource(this.previewId);
  }

  async fetchRecord(recordUrl: string): Promise<OgmRecord> {
    const response = await fetch(recordUrl);
    const data = await response.json();
    return new OgmRecord(data);
  }

  render() {
    return (
      <div class="container">
        <ogm-menubar record={this.record} loading={this.loading}></ogm-menubar>
        <div class="map-container">
          <ogm-sidebar record={this.record} open={this.sidebarOpen}></ogm-sidebar>
          <div id="map"></div>
        </div>
      </div>
    );
  }
}
