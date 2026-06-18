import { Component, Element, Prop, h, Watch, Method, Event, EventEmitter } from '@stencil/core';
import { Protocol as PMTilesProtocol } from 'pmtiles';
import maplibregl from 'maplibre-gl';
import type { EaseToOptions } from 'maplibre-gl';

import type { OgmRecord } from '../../lib/record';
import { getElement } from '../../lib/elements';
import { getSources } from '../../lib/sources';
import { getMapPreviewers } from '../../lib/previewers';
import Previewer from '../../lib/previewers/previewer';

// Register PMTiles protocol
const protocol = new PMTilesProtocol();
maplibregl.addProtocol('pmtiles', protocol.tile);

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
  @Prop() padding: number = 0;
  @Event() mapIdle: EventEmitter<void>;
  @Event() mapLoading: EventEmitter<void>;

  // MapLibre map instance
  private map: maplibregl.Map;

  // Container element reference for fullscreen
  private containerEl: HTMLElement;

  // Previewers for the currently previewed sources
  private previewers: Previewer[] = [];

  // Set up the mapLibre map and event bindings on load
  componentDidLoad() {
    this.map = new maplibregl.Map({
      container: getElement(this.el, '#map'),
      attributionControl: false,
      cooperativeGestures: true,
      style: this.baseMapStyle,
      center: [0, 0],
      zoom: 2,
      minZoom: 2,
    });
    this.getContainer();
    this.addControls();
    this.map.on('idle', () => this.mapIdle.emit());
    this.map.on('load', () => this.previewRecord(this.record));

    // View as a globe with atmosphere effects
    this.map.on('style.load', () => {
      this.map.setProjection({
        type: 'globe',
      });
      this.map.setSky({
        'sky-color': '#199EF3',
        'sky-horizon-blend': 0.5,
        'horizon-color': '#ffffff',
        'horizon-fog-blend': 0.5,
        'fog-color': '#0000ff',
        'fog-ground-blend': 0.5,
        'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 10, 1, 12, 0],
      });
    });
  }

  // Find the container element for the map (used for fullscreen control)
  private getContainer() {
    const containerEl = this.el.parentElement?.parentElement;
    if (!containerEl) throw new Error('Could not find map container element');
    this.containerEl = containerEl;
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
  }

  @Watch('record')
  async previewRecord(record: OgmRecord) {
    if (!record) return;
    this.mapLoading.emit();

    // Clear any existing preview layers and sources
    await Promise.all(this.previewers.map(previewer => previewer.clearPreview()));
    this.previewers = [];

    // Create sources and previewers using references
    const sources = getSources(record);
    const previewOptions = { fillColor: this.fillColor, lineColor: this.lineColor, opacity: this.previewOpacity / 100 };
    const previewers = await getMapPreviewers(sources, this.map, previewOptions);

    // Preview each source
    for (const previewer of previewers) {
      this.previewers.push(previewer);
      await previewer.preview();
    }

    // Fit to bounds from the record
    const bounds = record.getBounds();
    if (bounds) await this.fitMapBounds(bounds);

    this.mapIdle.emit();
  }

  // Fit the map to the provided bounds
  async fitMapBounds(bounds: maplibregl.LngLatBoundsLike) {
    return new Promise<void>(resolve => {
      this.map.once('moveend', () => resolve());
      this.map.fitBounds(bounds, { padding: this.padding });
    });
  }

  // When padding is changed, move the map over to make room for the sidebar
  @Watch('padding')
  async onPaddingChange() {
    return await this.easeMapTo({ padding: { left: this.padding } });
  }

  // Move the map (e.g. when the sidebar moves)
  @Method()
  async easeMapTo(options: EaseToOptions) {
    return await this.map.easeTo(options);
  }

  // Base map style based on the theme
  private get baseMapStyle() {
    return this.theme === 'dark' ? 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json' : 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';
  }

  // Fill colors for vector data based on the theme
  private get fillColor() {
    return window.getComputedStyle(this.el).getPropertyValue('--sl-color-primary-500');
  }

  // Line/stroke color for vector data based on the theme
  private get lineColor() {
    return window.getComputedStyle(this.el).getPropertyValue('--sl-color-neutral-900');
  }

  render() {
    return <div id="map" class={`sl-theme-${this.theme}`}></div>;
  }
}
