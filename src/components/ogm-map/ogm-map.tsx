import { Component, Element, Event, EventEmitter, h, Listen, Method, Prop, Watch } from '@stencil/core';
import maplibregl from 'maplibre-gl';
import { Protocol as PMTilesProtocol } from 'pmtiles';

import CogResource from '../../lib/resources/cog';
import GeoJsonResource from '../../lib/resources/geojson';
import OpenIndexMapResource from '../../lib/resources/openindexmap';
import PMTilesResource from '../../lib/resources/pmtiles';
import RasterResource from '../../lib/resources/raster';
import Resource from '../../lib/resources/resource';
import TileJsonResource from '../../lib/resources/tilejson';
import WmsResource from '../../lib/resources/wms';

import { getElement } from '../../lib/elements';
import { referenceError, PreviewError } from '../../lib/errors';
import { mercatorBbox, mercatorGeomToLngLat } from '../../lib/geometry';
import CogPreviewer from '../../lib/previewers/cog';
import GeoJsonPreviewer from '../../lib/previewers/geojson';
import MapPreviewer from '../../lib/previewers/map';
import OpenIndexMapPreviewer from '../../lib/previewers/openindexmap';
import PMTilesRasterPreviewer from '../../lib/previewers/pmtiles-raster';
import PMTilesVectorPreviewer from '../../lib/previewers/pmtiles-vector';
import RasterPreviewer from '../../lib/previewers/raster';
import TileJsonRasterPreviewer from '../../lib/previewers/tilejson-raster';
import TileJsonVectorPreviewer from '../../lib/previewers/tilejson-vector';
import WmsPreviewer from '../../lib/previewers/wms';
import MapLibreTheme from '../../lib/themes/maplibre';

// Register PMTiles protocol
const protocol = new PMTilesProtocol();
maplibregl.addProtocol('pmtiles', protocol.tile);

// Size in CSS pixels of the window we ask a WMS about when inspecting. GetFeatureInfo
// locates a click by mapping a pixel grid onto a bbox, which assumes the view is a
// flat, north-up rectangle - but ours can be rotated, pitched, or drawn as a globe. So
// we describe a small window around the click rather than the whole viewport, which
// keeps that assumption true to within a fraction of a pixel. Odd, so the clicked pixel
// is the exact center of the window.
const WMS_QUERY_WINDOW = 51;

@Component({
  tag: 'ogm-map',
  styleUrl: 'ogm-map.css',
  shadow: true,
})
export class OgmMap {
  @Element() el: HTMLElement;
  @Prop() previewResource: Resource;
  @Prop() theme: 'light' | 'dark';
  @Prop() padding: number = 0;
  @Event() mapIdle: EventEmitter<void>;
  @Event() mapLoading: EventEmitter<void>;
  @Event() previewError: EventEmitter<PreviewError>;

  // Guards against reporting more than one error per load attempt
  private errorReported: boolean = false;

  // MapLibre map instance and popup instance for feature info display
  protected map: maplibregl.Map;
  protected mapTheme: MapLibreTheme;
  protected popup: maplibregl.Popup | undefined = undefined;
  protected attributesEl: HTMLOgmAttributesElement;
  protected hoveredFeature: maplibregl.MapGeoJSONFeature | undefined = undefined;

  // Container element reference for fullscreen
  protected containerEl: HTMLElement;

  // Previewer for the currently previewed resource
  protected previewer: MapPreviewer | undefined = undefined;

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
    this.map.on('load', () => this.loadResource(this.previewResource));
    this.map.on('mousemove', this.handleHover.bind(this));
    this.map.on('click', this.handleClick.bind(this));
    this.map.on('error', this.handleMapError.bind(this));

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

  // Get the appropriate previewer for our resource
  protected async getMapPreviewer(map: maplibregl.Map) {
    const style = this.mapTheme.getStyle();
    if (this.previewResource instanceof OpenIndexMapResource) return new OpenIndexMapPreviewer(this.previewResource, map, style);
    else if (this.previewResource instanceof GeoJsonResource) return new GeoJsonPreviewer(this.previewResource, map, style);
    else if (this.previewResource instanceof PMTilesResource) {
      if (await this.previewResource.isVector()) return new PMTilesVectorPreviewer(this.previewResource, map, style);
      else return new PMTilesRasterPreviewer(this.previewResource, map, style);
    } else if (this.previewResource instanceof TileJsonResource) {
      if (await this.previewResource.isVector()) return new TileJsonVectorPreviewer(this.previewResource, map, style);
      else return new TileJsonRasterPreviewer(this.previewResource, map, style);
    } else if (this.previewResource instanceof WmsResource) return new WmsPreviewer(this.previewResource, map, style);
    else if (this.previewResource instanceof CogResource) return new CogPreviewer(this.previewResource, map, style);
    else if (this.previewResource instanceof RasterResource) return new RasterPreviewer(this.previewResource, map, style);
  }

  @Watch('previewResource')
  async loadResource(resource: Resource) {
    // Do nothing if we didn't get passed a resource
    if (!resource) return;

    // Fresh load attempt: allow one error to be reported again for this source
    this.errorReported = false;

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

      // Get the appropriate previewer for our resource and preview it
      this.previewer = await this.getMapPreviewer(this.map);
      if (!this.previewer) throw new Error(`No previewer found for resource: ${resource.constructor.name}`);
      await this.previewer.preview();

      // Fit to bounds from the record; the spinner stays up until the map finishes moving
      const bounds = await this.previewResource.getBounds();
      if (bounds) await this.fitMapBounds(bounds);
    } catch (error) {
      console.error(`Error previewing resource ${resource.url}:`, error);
      if (!this.errorReported) {
        this.errorReported = true;
        this.previewError.emit(referenceError(error, resource.label(), resource.url));
      }
    } finally {
      this.mapIdle.emit();
    }
  }

  // When the theme changes, swap the basemap to match.
  @Watch('theme')
  onThemeChange() {
    if (!this.map) return;
    this.map.setStyle(this.mapTheme.getBaseMapStyle());
    this.map.once('style.load', async () => await this.loadResource(this.previewResource));
  }

  // Surface MapLibre errors tied to the current previewed resource, skipping the
  // noise from basemap/glyph/sprite loads, and deduped to a single alert per load attempt.
  protected handleMapError(event: maplibregl.ErrorEvent & { sourceId?: string }) {
    if (this.errorReported || !this.previewResource || !this.previewer) return;
    if (!this.previewer.sourceIds.includes(event.sourceId ?? '')) return;
    this.errorReported = true;
    this.previewError.emit(referenceError(event.error, this.previewResource.label(), this.previewResource.url));
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
    // Always use it for WMS, since we don't know until we make the request
    if (this.previewer instanceof WmsPreviewer) {
      this.map.getCanvas().style.cursor = 'crosshair';
      return;
    }

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
  protected async handleClick(event: maplibregl.MapMouseEvent) {
    // Clear any existing popup and feature selection
    this.clearFeatureSelection();
    this.destroyPopup();

    // Get the features, if any, at the clicked point. If none, do nothing.
    const features = await this.handleInspection(event.point);
    if (features.length === 0) return;

    // Create and populate the attributes popup and select the first feature if multiple
    this.attributesEl.features = features;
    this.createPopup(event.lngLat);
    this.selectFeature(features[0]);
  }

  // Handle inspection of features, delegating to previewer if WMS
  protected async handleInspection(point: maplibregl.Point): Promise<maplibregl.MapGeoJSONFeature[]> {
    if (!this.previewer) return [];

    let features: maplibregl.MapGeoJSONFeature[] = [];
    if (this.previewer instanceof WmsPreviewer) {
      features = await this.handleWmsInspection(point);
    } else {
      features = this.map.queryRenderedFeatures(point, { layers: this.previewLayers });
    }
    return features;
  }

  // Special handling for WMS inspection, which requires a GetFeatureInfo request
  protected async handleWmsInspection(point: maplibregl.Point): Promise<maplibregl.MapGeoJSONFeature[]> {
    if (!(this.previewer instanceof WmsPreviewer)) return [];

    // Corners of the query window, in the same CSS pixel space as the click. Let
    // MapLibre unproject them so the geography stays right under any projection, then
    // take their EPSG:3857 envelope, since that is the CRS we request.
    const half = (WMS_QUERY_WINDOW - 1) / 2;
    const corners = [
      [point.x - half, point.y - half],
      [point.x + half, point.y - half],
      [point.x + half, point.y + half],
      [point.x - half, point.y + half],
    ].map(([x, y]) => this.map.unproject([x, y]));

    const response = await this.previewer.inspect({
      bbox: mercatorBbox(corners),
      width: WMS_QUERY_WINDOW,
      height: WMS_QUERY_WINDOW,
      x: half,
      y: half,
    });

    if (!response.ok) throw new PreviewError(`WMS GetFeatureInfo request failed with status ${response.status}`);

    const data = await response.json();
    if (!data || !data.features || !Array.isArray(data.features)) return [];

    return data.features.map((feature: any) => ({
      ...feature,
      geometry: feature.geometry && mercatorGeomToLngLat(feature.geometry),
      source: (this.previewer as WmsPreviewer).getSourceId(),
    }));
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
    if (this.previewer instanceof WmsPreviewer) {
      this.previewer.clearHighlight();
    } else {
      this.attributesEl.features.forEach(feature => {
        this.map.setFeatureState({ source: feature.source, id: feature.id, sourceLayer: feature.sourceLayer }, { selected: false });
      });
    }
    this.attributesEl.features = [];
  }

  // Set styling of a single feature to selected state
  protected selectFeature(feature: maplibregl.MapGeoJSONFeature) {
    // A WMS raster has no client-side features to restyle, so the previewer outlines the
    // geometry that GetFeatureInfo returned instead
    if (this.previewer instanceof WmsPreviewer) {
      this.previewer.highlightFeatures([feature]);
      return;
    }
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
