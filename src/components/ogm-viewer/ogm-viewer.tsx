import { Component, Element, Prop, Watch, State, Event, Listen, EventEmitter, h } from '@stencil/core';
import { Map } from 'maplibre-gl';

import { OgmRecord } from '../../utils/record';
import { setAssetBasePath } from '../../utils/utils';

// Only need to call this once, at the top level
setAssetBasePath();

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

  private map: Map;

  async componentWillLoad() {
    if (this.recordUrl) return await this.updateRecord();
  }

  componentDidLoad() {
    this.map = new Map({
      container: this.el.shadowRoot.getElementById('map'),
      style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
      center: [0, 0],
      zoom: 1,
    });
    this.map.once('load', this.mapDidLoad.bind(this));
  }

  mapDidLoad() {
    // Add WMS layer if references contain a WMS URL
    if (this.record && this.record.references['http://www.opengis.net/def/serviceType/ogc/wms']) {
      this.addPreview();
    }
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

    const wmsUrl = this.record.references.wms;
    const bounds = this.record.getBounds();

    this.clearPreview();

    this.map.addSource('preview', {
      type: 'raster',
      tiles: [
        `${wmsUrl}?service=WMS&request=GetMap&layers=${this.record.wxsIdentifier}&bbox={bbox-epsg-3857}&srs=EPSG%3A3857&width=256&height=256&format=image/png&transparent=true`,
      ],
      tileSize: 256,
      attribution: this.record.publishers.join(', '),
    });

    this.map.addLayer({
      id: 'preview',
      type: 'raster',
      source: 'preview',
    });

    this.map.fitBounds(bounds, { padding: 20 });
  }

  // Remove the preview layer and source from the map
  clearPreview() {
    if (this.map.getLayer('preview')) this.map.removeLayer('preview');
    if (this.map.getSource('preview')) this.map.removeSource('preview');
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
