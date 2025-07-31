import { Component, Element, Prop, Watch, State, Listen, h, getAssetPath } from '@stencil/core';
import { setBasePath } from '@shoelace-style/shoelace/dist/utilities/base-path.js';
import maplibregl from 'maplibre-gl';
import { cogProtocol } from '@geomatico/maplibre-cog-protocol';

import { OgmRecord } from '../../utils/record';
import { addLayerInspection } from '../../utils/inspection';
import { getPreviewSource, getPreviewLayers, getBoundsPreviewSource, getBoundsPreviewLayers } from '../../utils/sources';

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

  // MapLibre map instance
  private map: maplibregl.Map;

  // Track source and layer IDs for bounds and preview layers
  private boundsSourceId: string;
  private boundsLayerIds: string[] = [];
  private previewSourceId: string;
  private previewLayerIds: string[] = [];

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
    return window.getComputedStyle(this.el).getPropertyValue('--sl-color-primary-200');
  }

  // Line/stroke color for vector data based on the theme
  private get lineColor() {
    return window.getComputedStyle(this.el).getPropertyValue('--sl-color-primary-500');
  }

  componentDidLoad() {
    this.map = new maplibregl.Map({
      container: this.el.shadowRoot.getElementById('map'),
      attributionControl: false,
      style: this.baseMapStyle,
      center: [0, 0],
      zoom: 1,
    });

    this.map.addControl(
      new maplibregl.NavigationControl({
        visualizePitch: true,
      }),
    );
    this.map.addControl(
      new maplibregl.FullscreenControl({
        container: this.el,
      }),
    );
    this.map.addControl(new maplibregl.GlobeControl());
    this.map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: {
          enableHighAccuracy: true,
        },
      }),
    );
    this.map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
      }),
    );

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

    // Clear any existing preview and indicate loading
    this.loading = true;
    this.clearPreview();

    // Add the source for the record's geometry
    const boundsSource = getBoundsPreviewSource(this.record);
    if (boundsSource) {
      this.map.addSource(boundsSource.id, boundsSource.source);
      this.boundsSourceId = boundsSource.id;
    }

    // Add the source for the data preview
    const previewSource = getPreviewSource(this.record);
    if (previewSource) {
      this.map.addSource(previewSource.id, previewSource.source);
      this.previewSourceId = previewSource.id;
    }

    // If there are preview layers and the record is not restricted, add them
    if (previewSource) {
      const previewLayers = getPreviewLayers(this.record, previewSource);
      if (previewLayers && !this.record.restricted) {
        this.previewLayerIds = previewLayers.map(layer => layer.id);
        previewLayers.forEach(layer => this.addLayerInspection(layer, previewSource.infoUrl));
      }
    }

    // Otherwise, just add the bounds preview layers
    if (!this.previewLayerIds.length) {
      const boundsLayers = getBoundsPreviewLayers(this.record);
      if (boundsLayers) {
        this.boundsLayerIds = boundsLayers.map(layer => layer.id);
        boundsLayers.forEach(layer => this.map.addLayer(layer));
      }
    }

    // Ensure fill colors are correctly set
    this.setPreviewFill();

    // Fit the map to the bounds of the record's geometry
    const bounds = this.record.getBounds();
    if (bounds) this.map.fitBounds(bounds, { padding: 40 });
  }

  addLayerInspection(layer, infoUrl){
    this.map.addLayer(layer)
    addLayerInspection(layer.source, infoUrl, this.record.references, this.map)
  }

  // Style the preview layers based on the current theme (vectors only)
  setPreviewFill() {
    const layerIds = this.boundsLayerIds.concat(this.previewLayerIds);
    const layers = layerIds.map(id => this.map.getLayer(id)).filter(Boolean);

    layers.forEach(layer => {
      if (layer.type === 'fill') {
        this.map.setPaintProperty(layer.id, 'fill-color', this.fillColor);
        this.map.setPaintProperty(layer.id, 'fill-outline-color', this.lineColor);
      } else if (layer.type === 'line') {
        this.map.setPaintProperty(layer.id, 'line-color', this.lineColor);
      } else if (layer.type === 'circle') {
        this.map.setPaintProperty(layer.id, 'circle-color', this.fillColor);
        this.map.setPaintProperty(layer.id, 'circle-stroke-color', this.lineColor);
      }
    });
  }

  // Listen for opacity changes from the sidebar and adjust the preview layer
  @Listen('opacityChange')
  adjustPreviewOpacity(event: CustomEvent<number>) {
    if (!this.map) return;

    // Only applies to data preview, not the bounding box
    const opacity = event.detail;
    const layers = this.previewLayerIds.map(id => this.map.getLayer(id)).filter(Boolean);

    layers.forEach(layer => {
      if (layer.type === 'raster') {
        this.map.setPaintProperty(layer.id, 'raster-opacity', opacity / 100);
      } else if (layer.type === 'fill') {
        this.map.setPaintProperty(layer.id, 'fill-opacity', opacity / 100);
      } else if (layer.type === 'line') {
        this.map.setPaintProperty(layer.id, 'line-opacity', opacity / 100);
      } else if (layer.type === 'circle') {
        this.map.setPaintProperty(layer.id, 'circle-opacity', opacity / 100);
      }
    });
  }

  // Remove all preview layers and sources from the map
  clearPreview() {
    if (!this.map) return;

    // Remove bounds layers and source
    this.boundsLayerIds.forEach(id => this.map.removeLayer(id));
    this.boundsLayerIds = [];
    if (this.boundsSourceId) this.map.removeSource(this.boundsSourceId);
    this.boundsSourceId = null;

    // Remove preview layers and source
    this.previewLayerIds.forEach(id => this.map.removeLayer(id));
    this.previewLayerIds = [];
    if (this.previewSourceId) this.map.removeSource(this.previewSourceId);
    this.previewSourceId = null;
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
