import { Component, Element, Event, EventEmitter, h, Listen, Method, Prop, Watch } from '@stencil/core';
import maplibregl from 'maplibre-gl';
import { Protocol as PMTilesProtocol } from 'pmtiles';

import CogSource from '../../lib/sources/cog';
import GeoJSONSource from '../../lib/sources/geojson';
import OpenIndexMapSource from '../../lib/sources/openindexmap';
import PMTilesSource from '../../lib/sources/pmtiles';
import RasterSource from '../../lib/sources/raster';
import Source from '../../lib/sources/source';
import WmsSource from '../../lib/sources/wms';

import { getElement } from '../../lib/elements';
import CogPreviewer from '../../lib/previewers/cog';
import GeoJSONPreviewer from '../../lib/previewers/geojson';
import MapLibrePreviewer from '../../lib/previewers/maplibre';
import OpenIndexMapPreviewer from '../../lib/previewers/openindexmap';
import PMTilesRasterPreviewer from '../../lib/previewers/pmtiles-raster';
import PMTilesVectorPreviewer from '../../lib/previewers/pmtiles-vector';
import RasterPreviewer from '../../lib/previewers/raster';
import WmsPreviewer from '../../lib/previewers/wms';
import MapLibreTheme from '../../lib/themes/maplibre';

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
  @Prop() source: Source;
  @Prop() theme: 'light' | 'dark';
  @Prop() padding: number = 0;
  @Event() mapIdle: EventEmitter<void>;
  @Event() mapLoading: EventEmitter<void>;

  // MapLibre map instance and popup instance for feature info display
  protected map: maplibregl.Map;
  protected mapTheme: MapLibreTheme;
  protected popup: maplibregl.Popup | undefined = undefined;
  protected attributesEl: HTMLOgmAttributesElement;
  protected hoveredFeature: maplibregl.MapGeoJSONFeature | undefined = undefined;

  // Container element reference for fullscreen
  protected containerEl: HTMLElement;

  // Previewer for the currently previewed source
  protected previewer: MapLibrePreviewer | undefined = undefined;

  // Set up the mapLibre map and event bindings on load
  componentDidLoad() {
    this.mapTheme = new MapLibreTheme(this.el);
    this.map = new maplibregl.Map({
      container: getElement(this.el, '#map'),
      attributionControl: false,
      cooperativeGestures: true,
      style: this.mapTheme.getBaseMapStyle(),
      center: [0, 0],
      zoom: 2,
      minZoom: 2,
    });
    this.getContainer();
    this.addControls();
    this.map.on('load', () => this.previewSource(this.source));
    this.map.on('mousemove', this.handleHover.bind(this));
    this.map.on('click', this.handleClick.bind(this));

    // View as a globe with atmosphere effects
    this.map.on('style.load', () => {
      this.map.setProjection({ type: 'globe' });
      this.map.setSky(this.mapTheme.getSkyStyle());
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
    const viewerEl = document.querySelector('ogm-viewer') as HTMLElement;
    if (!viewerEl) throw new Error('Could not find ogm-viewer element');
    const containerEl = getElement(viewerEl, '.container') as HTMLElement;
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

  // Get the appropriate previewer for our source
  protected async getMapPreviewer(map: maplibregl.Map) {
    const style = this.mapTheme.getStyle();
    if (this.source instanceof OpenIndexMapSource) return new OpenIndexMapPreviewer(this.source, map, style);
    else if (this.source instanceof GeoJSONSource) return new GeoJSONPreviewer(this.source, map, style);
    else if (this.source instanceof PMTilesSource) {
      if (await this.source.isVector()) return new PMTilesVectorPreviewer(this.source, map, style);
      else return new PMTilesRasterPreviewer(this.source, map, style);
    } else if (this.source instanceof WmsSource) return new WmsPreviewer(this.source, map, style);
    else if (this.source instanceof CogSource) return new CogPreviewer(this.source, map, style);
    else if (this.source instanceof RasterSource) return new RasterPreviewer(this.source, map, style);
  }

  @Watch('source')
  async previewSource(source: Source) {
    // Do nothing if we didn't get passed a source
    if (!source) return;

    // Indicate loading state so we can show the spinner
    this.mapLoading.emit();

    try {
      // Close popup if one is open
      this.clearFeatureSelection();
      this.destroyPopup();

      // Clear existing preview
      if (this.previewer) {
        await this.previewer.clearPreview();
        this.previewer = undefined;
      }

      // Get the appropriate previewer for our source and preview it
      this.previewer = await this.getMapPreviewer(this.map);
      if (!this.previewer) throw new Error(`No previewer found for source: ${source.constructor.name}`);
      await this.previewer.preview();

      // Fit to bounds from the record; the spinner stays up until the map finishes moving
      const bounds = await this.source.getBounds();
      if (bounds) await this.fitMapBounds(bounds);
    } finally {
      // Emit exactly once, after the move completes (or on error), to signal the map is ready. This
      // is the only signal that hides the spinner, so it must always fire and never fire early.
      this.mapIdle.emit();
    }
  }

  // Fit the map to the given bounds; resolve once the move finishes. Guard the case where the bounds
  // can't produce a camera - e.g. sidebar padding wider than the viewport, or a hidden, zero-size
  // inactive tab panel - because then fitBounds won't move, 'moveend' never fires, and awaiting this
  // promise (and the loading state that depends on it) would hang forever.
  async fitMapBounds(bounds: maplibregl.LngLatBoundsLike) {
    if (!this.map.cameraForBounds(bounds)) return;
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
    if (features.length > 0) {
      this.map.getCanvas().style.cursor = 'crosshair';
      this.hoverFeature(features[0]);
    } else {
      this.map.getCanvas().style.cursor = '';
      this.clearHoveredFeature();
    }
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
    this.attributesEl.features = [];
  }

  // Set styling of a single feature to selected state
  protected selectFeature(feature: maplibregl.MapGeoJSONFeature) {
    this.map.setFeatureState({ source: feature.source, id: feature.id, sourceLayer: feature.sourceLayer }, { selected: true });
  }

  // Set styling of a single feature to hovered state
  protected hoverFeature(feature: maplibregl.MapGeoJSONFeature) {
    this.clearHoveredFeature();
    this.hoveredFeature = feature;
    this.map.setFeatureState({ source: feature.source, id: feature.id, sourceLayer: feature.sourceLayer }, { hover: true });
  }

  // Clear the hovered feature state
  protected clearHoveredFeature() {
    if (this.hoveredFeature) {
      this.map.setFeatureState({ source: this.hoveredFeature.source, id: this.hoveredFeature.id, sourceLayer: this.hoveredFeature.sourceLayer }, { hover: false });
      this.hoveredFeature = undefined;
    }
  }

  // Create a new popup and set its content and location
  protected createPopup(location: maplibregl.LngLatLike) {
    this.popup = new maplibregl.Popup({ maxWidth: 'none' }).setDOMContent(this.attributesEl).setLngLat(location).addTo(this.map);
    this.popup.on('close', this.clearFeatureSelection.bind(this));
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
    return this.previewer?.layerIds || [];
  }

  render() {
    return <div id="map" class={`wa-${this.theme}`}></div>;
  }
}
