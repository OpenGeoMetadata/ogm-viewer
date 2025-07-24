import { Component, Element, Prop, Watch, State, Event, Listen, EventEmitter, h } from '@stencil/core';
import maplibregl from 'maplibre-gl';
import { cogProtocol } from '@geomatico/maplibre-cog-protocol';

import { OgmRecord } from '../../utils/record';
import { setAssetBasePath } from '../../utils/utils';
import { getPreviewLayer } from '../../utils/sources';

// Only need to call this once, at the top level
setAssetBasePath();

// Add support for COG protocol
maplibregl.addProtocol('cog', cogProtocol);

@Component({
  tag: 'ogm-viewer',
  styleUrl: 'ogm-viewer.css',
  shadow: true,
})
export class OgmViewer {
  @Element() el: HTMLElement;
  @Prop() recordUrl: string;
  @State() sidebarOpen: boolean = false;
  @State() record: OgmRecord;
  @Event() recordLoaded: EventEmitter<OgmRecord>;

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
    this.map.once('load', this.mapDidLoad.bind(this));
  }

  mapDidLoad() {
    this.addPreview();
  }

  // Sidebar emits this event when menu button is clicked
  @Listen('sidebarToggled')
  _toggleSidebar() {
    this.sidebarOpen = !this.sidebarOpen;
  }

  @Watch('recordUrl')
  private async updateRecord() {
    if (this.recordUrl) this.record = await this.fetchRecord(this.recordUrl);
  }

  @Watch('record')
  addPreview() {
    if (!this.record || !this.map) return;

    const bounds = this.record.getBounds();

    this.clearPreview();

    const previewLayer = getPreviewLayer(this.record);
    if (previewLayer) {
      this.previewId = previewLayer.id;
      this.map.addLayer(previewLayer);
    }

    this.map.fitBounds(bounds, { padding: 20 });
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
        <ogm-menubar record={this.record}></ogm-menubar>
        <div class="map-container">
          <ogm-sidebar record={this.record} open={this.sidebarOpen}></ogm-sidebar>
          <div id="map"></div>
        </div>
      </div>
    );
  }
}
