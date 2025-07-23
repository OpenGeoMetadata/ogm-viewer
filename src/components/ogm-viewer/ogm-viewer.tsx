import { Component, Element, Prop, Watch, State, Event, EventEmitter, h } from '@stencil/core';
import { Map } from 'maplibre-gl';

import '@shoelace-style/shoelace/dist/components/icon-button/icon-button.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';

import { OgmRecord } from '../../utils/record';

@Component({
  tag: 'ogm-viewer',
  styleUrl: 'ogm-viewer.css',
  shadow: true,
})
export class OgmViewer {
  @Element() el: HTMLElement;
  @Prop() recordUrl: string;
  @State() record: OgmRecord;
  @Event() recordLoaded: EventEmitter<OgmRecord>;
  @Event() sidebarToggled: EventEmitter<boolean>;

  private map: Map;

  async componentWillLoad() {
    if (this.recordUrl) return this.updateRecord();
  }

  componentDidLoad() {
    this.map = new Map({
      container: this.el.shadowRoot.getElementById('map'),
      style: 'https://demotiles.maplibre.org/style.json',
      center: [0, 0],
      zoom: 2,
    });
    this.map.once('load', this.mapDidLoad.bind(this));

    // Set up the sidebar toggle button
    const menuButton = this.el.shadowRoot.querySelector('.menu-button');
    menuButton.addEventListener('click', () => {
      this.sidebarToggled.emit(true);
    });
  }

  mapDidLoad() {
    // Add WMS layer if references contain a WMS URL
    if (this.record && this.record.references['http://www.opengis.net/def/serviceType/ogc/wms']) {
      this.addPreview();
    }
  }

  @Watch('recordUrl')
  async updateRecord() {
    if (this.recordUrl) this.record = await this.fetchRecord(this.recordUrl);
  }

  @Watch('record')
  addPreview() {
    if (!this.record) return;

    const wmsUrl = this.record.references['http://www.opengis.net/def/serviceType/ogc/wms'];
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
        <div class="menubar">
          <sl-tooltip content="Open sidebar">
            <sl-icon-button name="list" label="Open sidebar" class="menu-button" disabled={!this.record}></sl-icon-button>
          </sl-tooltip>
          <div class="title">{this.record && this.record.title}</div>
        </div>
        <div class="map-container">
          <div id="map" style={{ width: '100%', height: '400px' }}></div>
          <ogm-sidebar record={this.record}></ogm-sidebar>
        </div>
      </div>
    );
  }
}
