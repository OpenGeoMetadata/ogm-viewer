import { Component, Element, Prop, State, h, Watch, Method, Event, EventEmitter } from '@stencil/core';
import maplibregl from 'maplibre-gl';
import { cogProtocol } from '@geomatico/maplibre-cog-protocol';
import { Protocol as pmtilesProtocol } from 'pmtiles';
import { getPreviewSource, getPreviewLayers, getBoundsPreviewSource, getBoundsPreviewLayers } from '../../utils/sources';

import type { OgmRecord } from '../../utils/record';
import type { AddLayerObject, EaseToOptions } from 'maplibre-gl';
import type { AddSourceObject } from '../../utils/sources';

// Add support for COG protocol
maplibregl.addProtocol('cog', cogProtocol);

// Add support for PMTiles protocol
let pmtProtocol = new pmtilesProtocol();
maplibregl.addProtocol('pmtiles', pmtProtocol.tile);

@Component({
  tag: 'ogm-map',
  styleUrl: 'ogm-map.css',
  shadow: true,
})
export class OgmMap {
  @Element() el: HTMLElement;
  @Prop() record: OgmRecord;
  @Prop() theme: 'light' | 'dark';
  @Prop() previewOpacity: number = 100;
  @Event() mapIdle: EventEmitter<void>;
  @Event() mapLoading: EventEmitter<void>;

  // Track sources and layers for bounds and preview
  @State() boundsSource: AddSourceObject;
  @State() boundsLayers: AddLayerObject[] = [];
  @State() previewSource: AddSourceObject;
  @State() previewLayers: AddLayerObject[] = [];

  // MapLibre map instance
  private map: maplibregl.Map;

  // Container element reference for fullscreen
  private containerEl: HTMLElement;

  // Set up the mapLibre map and event bindings on load
  componentDidLoad() {
    this.map = new maplibregl.Map({
      container: this.el.shadowRoot.getElementById('map'),
      attributionControl: false,
      style: this.baseMapStyle,
      center: [0, 0],
      zoom: 1,
    });
    this.containerEl = this.el.parentElement.parentElement;
    this.addControls();
    this.map.on('idle', () => this.mapIdle.emit());
    this.map.on('load', () => this.previewRecord(this.record));
  }

  // Add controls to the map
  private addControls() {
    this.map.addControl(
      new maplibregl.NavigationControl({
        visualizePitch: true,
      }),
    );
    this.map.addControl(
      new maplibregl.FullscreenControl({
        container: this.containerEl,
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
  }

  @Watch('record')
  previewRecord(record: OgmRecord) {
    // Clear the map of previous layers and sources; if nothing new, bail out
    if (this.record) this.clearMap();
    if (!record) return;

    // Indicate loading
    this.mapLoading.emit();

    // Add the sources for the record's geometry and the data preview
    this.boundsSource = getBoundsPreviewSource(this.record);
    this.previewSource = getPreviewSource(this.record);
    console.log(this.previewSource, 'preview source');

    // If the record is not restricted and has a source, add preview layers
    if (this.previewSource && !this.record.restricted) {
      this.previewLayers = getPreviewLayers(this.record, this.previewSource);
      console.log('preview layers', this.previewLayers);
    }

    // Otherwise if we have bounds, just add the bounds preview layers
    else if (this.boundsSource) {
      this.boundsLayers = getBoundsPreviewLayers(this.record);
    }

    // Fit the map to the record's bounding box
    this.fitMapBounds(this.record.getBounds());
  }

  // Remove all layers and sources from the map
  clearMap() {
    this.boundsLayers = [];
    this.previewLayers = [];
    this.boundsSource = null;
    this.previewSource = null;
  }

  // Fit the map to the provided bounds
  fitMapBounds(bounds: maplibregl.LngLatBoundsLike) {
    this.map.fitBounds(bounds, { padding: 40 });
  }

  // Move the map (e.g. when the sidebar moves)
  @Method()
  async easeMapTo(options: EaseToOptions) {
    return await this.map.easeTo(options);
  }

  // When new bounds/preview sources are set, swap them out for old ones
  @Watch('boundsSource')
  @Watch('previewSource')
  updateSource(source: AddSourceObject, oldSource: AddSourceObject) {
    if (!source && oldSource) return this.removeSource(oldSource.id);
    if (source) return this.addSource(source);
  }

  // When new bounds/preview layers are set, swap them out for old ones
  @Watch('boundsLayers')
  @Watch('previewLayers')
  updateLayers(layers: AddLayerObject[], oldLayers: AddLayerObject[]) {
    if (!layers || layers.length === 0) return oldLayers.forEach(layer => this.removeLayer(layer.id));
    layers.forEach(layer => this.addLayer(layer));
  }

  // Listen for opacity changes and adjust the preview layers
  @Watch('previewOpacity')
  updatePreviewOpacity(opacity: number) {
    this.previewLayers.forEach(layer => this.setLayerOpacity(layer.id, opacity));
  }

  // Add a source to the map
  private addSource(source: AddSourceObject) {
    return this.map.addSource(source.id, source.source);
  }

  // Remove a source from the map by ID
  private removeSource(id: string) {
    return this.map.removeSource(id);
  }

  // Add a layer to the map and style it based on the theme
  private addLayer(layer: AddLayerObject) {
    this.map.addLayer(layer);
    this.styleLayer(layer.id);
  }

  // Remove a layer from the map by ID
  private removeLayer(id: string) {
    return this.map.removeLayer(id);
  }

  // Style a layer based on the theme
  private styleLayer(id: string) {
    const layer = this.map.getLayer(id);
    if (!layer) return;

    if (layer.type === 'fill') {
      this.map.setPaintProperty(id, 'fill-color', this.fillColor);
      this.map.setPaintProperty(id, 'fill-outline-color', this.lineColor);
    } else if (layer.type === 'line') {
      this.map.setPaintProperty(id, 'line-color', this.lineColor);
    } else if (layer.type === 'circle') {
      this.map.setPaintProperty(id, 'circle-color', this.fillColor);
      this.map.setPaintProperty(id, 'circle-stroke-color', this.lineColor);
    }
  }

  // Set the opacity of a layer
  private setLayerOpacity(id: string, opacity: number) {
    const layer = this.map.getLayer(id);
    if (!layer) return;

    if (layer.type === 'raster') {
      this.map.setPaintProperty(layer.id, 'raster-opacity', opacity / 100);
    } else if (layer.type === 'fill') {
      this.map.setPaintProperty(layer.id, 'fill-opacity', opacity / 100);
    } else if (layer.type === 'line') {
      this.map.setPaintProperty(layer.id, 'line-opacity', opacity / 100);
    } else if (layer.type === 'circle') {
      this.map.setPaintProperty(layer.id, 'circle-opacity', opacity / 100);
    }
  }

  // Base map style based on the theme
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

  render() {
    return <div id="map" class={`sl-theme-${this.theme}`}></div>;
  }
}
