import { Component, Element, Prop, Watch, State, Listen, h, getAssetPath } from '@stencil/core';
import { setBasePath } from '@shoelace-style/shoelace/dist/utilities/base-path.js';
import maplibregl from 'maplibre-gl';
import { cogProtocol } from '@geomatico/maplibre-cog-protocol';

import { OgmRecord } from '../../utils/record';
import { getPreviewLayer, getBoundsPreviewLayer } from '../../utils/sources';

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
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';

@Component({
  tag: 'ogm-viewer',
  styleUrl: 'ogm-viewer.css',
  shadow: true,
})
export class OgmViewer {
  @Element() el: HTMLElement;
  @Prop() recordUrl: string;
  @Prop() theme: 'light' | 'dark';
  @State() record: OgmRecord;
  @State() sidebarOpen: boolean = false;
  @State() loading: boolean = false;

  private map: maplibregl.Map;
  private previewId: string;

  async componentWillLoad() {
    // If no theme provided, detect the user's system preference
    if (!this.theme) {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      this.theme = prefersDark ? 'dark' : 'light';
    }

    // Fetch the record if a URL is provided
    if (this.recordUrl) return await this.updateRecord();
  }

  private get baseMapStyle() {
    return this.theme === 'dark' ? 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json' : 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';
  }

  // Fill colors for vector data based on the theme
  private get fillColor() {
    return this.theme === 'dark' ? '#bbb' : '#444';
  }

  // Line/stroke color for vector data based on the theme
  private get lineColor() {
    return this.theme === 'dark' ? '#fff' : '#000';
  }

  componentDidLoad() {
    this.map = new maplibregl.Map({
      container: this.el.shadowRoot.getElementById('map'),
      attributionControl: false,
      style: this.baseMapStyle,
      center: [0, 0],
      zoom: 1,
    });

    this.map.addControl(new maplibregl.NavigationControl({
      visualizePitch: true,
    }));
    this.map.addControl(new maplibregl.FullscreenControl({
      container: this.el
    }));
    this.map.addControl(new maplibregl.GlobeControl());
    this.map.addControl(new maplibregl.GeolocateControl({
      positionOptions: {
        enableHighAccuracy: true
      },
    }));
    this.map.addControl(new maplibregl.AttributionControl({
      compact: true,
    }));

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
    if (previewLayer && !this.record.restricted) {
      this.previewId = previewLayer.id;
      this.map.addLayer(previewLayer);
    }
    
    else {
      const boundsLayer = getBoundsPreviewLayer(this.record);
      if (boundsLayer) {
        this.previewId = boundsLayer.id;
        this.map.addLayer(boundsLayer);
      }
    }

    if (this.previewId) {
      this.setPreviewFill();
      this.map.fitBounds(bounds, { padding: 20 });
    }
  }

  // Style the layer based on the current theme (vectors only)
  setPreviewFill() {
    const layer = this.map.getLayer(this.previewId);
    if (layer) {
      if (layer.type === 'fill') {
        this.map.setPaintProperty(this.previewId, 'fill-color', this.fillColor);
        this.map.setPaintProperty(this.previewId, 'fill-outline-color', this.lineColor);
      } else if (layer.type === 'line') {
        this.map.setPaintProperty(this.previewId, 'line-color', this.lineColor);
      } else if (layer.type === 'circle') {
        this.map.setPaintProperty(this.previewId, 'circle-color', this.lineColor);
        this.map.setPaintProperty(this.previewId, 'circle-stroke-color', this.lineColor);
      }
    }
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
      <div class={`container sl-theme-${this.theme}`}>
        <ogm-menubar theme={this.theme} record={this.record} loading={this.loading}></ogm-menubar>
        <div class="map-container">
          <ogm-sidebar theme={this.theme} record={this.record} open={this.sidebarOpen}></ogm-sidebar>
          <div id="map"></div>
        </div>
      </div>
    );
  }
}
