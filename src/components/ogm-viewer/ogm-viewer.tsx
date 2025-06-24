import { Component, Element, Prop, Watch, State, h } from '@stencil/core';
import { Map } from 'maplibre-gl';
import { OgmRecord } from '../../utils/record';

@Component({
  tag: 'ogm-viewer',
  styleUrl: 'ogm-viewer.css',
  shadow: true,
})
export class OgmViewer {
  /** Reference to the component's DOM element; needed to access the Map */
  @Element() el: HTMLElement;

  /** URL to an OGM record in JSON format */
  @Prop() recordUrl: string;

  /** The OGM record object, parsed from the recordUrl */
  @State() record: OgmRecord;

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
        <div class="title">{this.record ? this.record.title : 'OpenGeoMetadata Viewer'}</div>
        <div id="map" style={{ width: '100%', height: '400px' }}></div>
        <div class="metadata">
          <pre>{JSON.stringify(this.record, null, 2)}</pre>
        </div>
      </div>
    );
  }
}
