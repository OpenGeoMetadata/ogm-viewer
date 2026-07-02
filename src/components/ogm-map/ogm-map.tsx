import { Component, Element, Prop, h, Watch, Method, Event, EventEmitter, Listen } from '@stencil/core';
import { Protocol as PMTilesProtocol } from 'pmtiles';
import maplibregl from 'maplibre-gl';

import type { OgmRecord } from '../../lib/record';
import { getElement } from '../../lib/elements';
import { getSources } from '../../lib/sources';
import { getMapPreviewers } from '../../lib/previewers';
import MapLibrePreviewer from '../../lib/previewers/maplibre';

// Register PMTiles protocol
const protocol = new PMTilesProtocol();
maplibregl.addProtocol('pmtiles', protocol.tile);

// Web Awesome's palette tokens are documented inline (e.g. "#0a3a1d /* oklch(...) */").
// Browsers are supposed to strip CSS comments before exposing a custom property's computed
// value, but Safari has a bug where the comment survives, which MapLibre then rejects as an
// invalid color. Strip it defensively here so we don't depend on browser-specific behavior.
const readColorProperty = (el: Element, property: string): string => {
  return window
    .getComputedStyle(el)
    .getPropertyValue(property)
    .replace(/\/\*.*?\*\//g, '')
    .trim();
};

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

  // MapLibre map instance and popup instance for feature info display
  protected map: maplibregl.Map;
  protected popup: maplibregl.Popup | undefined = undefined;
  protected attributesEl: HTMLOgmAttributesElement;

  // Container element reference for fullscreen
  protected containerEl: HTMLElement;

  // Previewers for the currently previewed sources
  protected previewers: MapLibrePreviewer[] = [];

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
    this.map.on('mousemove', this.handleHover.bind(this));
    this.map.on('click', this.handleClick.bind(this));

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

    // Keep attributes outside Stencil render pipeline so that MapLibre can
    // use the HTML directly for the popup content
    this.attributesEl = document.createElement('ogm-attributes') as HTMLOgmAttributesElement;
    this.attributesEl.features = [];
  }

  // Clean up the map to prevent warnings/errors when removed from the DOM
  disconnectedCallback() {
    if (this.map) this.map.remove();
  }

  // Find the container element for the map (used for fullscreen control)
  protected getContainer() {
    const containerEl = this.el.parentElement?.parentElement;
    if (!containerEl) throw new Error('Could not find map container element');
    this.containerEl = containerEl;
  }

  // Add controls to the map
  protected addControls() {
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
    // Do nothing if we didn't get passed a record
    if (!record) return;

    // Indicate loading state so we can show the spinner
    this.mapLoading.emit();

    // Close popup if one is open
    this.clearFeatureSelection();
    this.destroyPopup();

    // Collect previewers to remove after the new record is previewed
    const oldPreviewers = [];
    while (this.previewers.length) oldPreviewers.push(this.previewers.pop() as MapLibrePreviewer);

    // Populate the new previewers and render them
    const sources = getSources(record);
    const previewOptions = {
      fillColor: this.fillColor,
      fillHighlightColor: this.fillHighlightColor,
      fillInvalidColor: this.fillInvalidColor,
      lineColor: this.lineColor,
      lineHighlightColor: this.lineHighlightColor,
      opacity: this.previewOpacity / 100,
    };
    const newPreviewers = await getMapPreviewers(sources, this.map, previewOptions);
    while (newPreviewers.length) this.previewers.push(newPreviewers.pop() as MapLibrePreviewer);
    for (const previewer of this.previewers) await previewer.preview();

    // Fit to bounds from the record
    const bounds = record.getBounds();
    if (bounds) await this.fitMapBounds(bounds);

    // Remove old previewers after the new ones are rendered
    for (const previewer of oldPreviewers) await previewer.clearPreview();

    // Emit map idle event to signal that the map is ready
    this.mapIdle.emit();
  }

  async fitMapBounds(bounds: maplibregl.LngLatBoundsLike) {
    return new Promise<void>(resolve => {
      this.map.once('moveend', () => resolve());
      this.map.fitBounds(bounds);
    });
  }

  // When padding is changed, move the map over to make room for the sidebar
  @Watch('padding')
  async onPaddingChange() {
    return await this.easeMapTo({ padding: { left: this.padding } });
  }

  // Move the map (e.g. when the sidebar moves)
  @Method()
  async easeMapTo(options: maplibregl.EaseToOptions) {
    return await this.map.easeTo(options);
  }

  // Use the crosshair cursor if there's something to inspect
  protected handleHover(event: maplibregl.MapMouseEvent) {
    const features = this.map.queryRenderedFeatures(event.point, { layers: this.previewLayers });
    if (features.length > 0) this.map.getCanvas().style.cursor = 'crosshair';
    else this.map.getCanvas().style.cursor = '';
  }

  // Show the attributes popup on click
  protected handleClick(event: maplibregl.MapMouseEvent) {
    // Clear any existing popup and feature selection
    this.clearFeatureSelection();
    this.destroyPopup();

    // Check if we have feature(s) to inspect at the clicked point
    const features = this.map.queryRenderedFeatures(event.point, { layers: this.previewLayers });
    if (features.length === 0) return;

    // Create and populate the attributes popup and select the first feature if multiple
    this.attributesEl.features = features;
    this.createPopup(event.lngLat);
    this.selectFeature(features[0]);
  }

  // Listen to selection events from the popup and highlight the selected feature
  @Listen('featureSelected', { target: 'body' })
  handleFeatureSelected(event: CustomEvent<maplibregl.MapGeoJSONFeature>) {
    this.clearFeatureSelection();
    const feature = event.detail;
    this.selectFeature(feature);
  }

  // Reset styling of all features to unselected state
  protected clearFeatureSelection() {
    this.attributesEl.features.forEach(feature => {
      this.map.setFeatureState({ source: feature.source, id: feature.id, sourceLayer: feature.sourceLayer }, { selected: false });
    });
  }

  // Set styling of a single feature to selected state
  protected selectFeature(feature: maplibregl.MapGeoJSONFeature) {
    this.map.setFeatureState({ source: feature.source, id: feature.id, sourceLayer: feature.sourceLayer }, { selected: true });
  }

  // Create a new popup and set its content and location
  protected createPopup(location: maplibregl.LngLatLike) {
    this.popup = new maplibregl.Popup({ maxWidth: 'none', closeButton: false }).setDOMContent(this.attributesEl).setLngLat(location).addTo(this.map);
  }

  // Remove popup from the map and clear the reference
  protected destroyPopup() {
    if (this.popup) {
      this.popup.remove();
      this.popup = undefined;
    }
  }

  // Get the IDs of all layers in the previewers
  protected get previewLayers() {
    return this.previewers.flatMap(previewer => previewer.layerIds);
  }

  // Base map style based on the theme
  protected get baseMapStyle() {
    return this.theme === 'dark' ? 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json' : 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';
  }

  // Fill colors for vector data, based on the theme
  protected get fillColor() {
    return readColorProperty(this.el, '--wa-color-brand-50');
  }

  // Fill color for vector data when selected, based on the theme
  protected get fillHighlightColor() {
    return readColorProperty(this.el, '--wa-color-success-50');
  }

  // Fill color for vector data when missing/invalid, based on the theme
  protected get fillInvalidColor() {
    return readColorProperty(this.el, '--wa-color-warning-50');
  }

  // Line/stroke color for vector data, based on the theme
  protected get lineColor() {
    return readColorProperty(this.el, '--wa-color-brand-80');
  }

  // Line/stroke color for vector data when selected, based on the theme
  protected get lineHighlightColor() {
    return readColorProperty(this.el, '--wa-color-success-80');
  }

  // Line/stroke color for vector data when missing/invalid, based on the theme
  protected get lineInvalidColor() {
    return readColorProperty(this.el, '--wa-color-warning-80');
  }

  render() {
    return <div id="map" class={`wa-${this.theme}`}></div>;
  }
}
