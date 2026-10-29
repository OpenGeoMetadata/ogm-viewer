import type { GeoJSONSource, MapGeoJSONFeature } from 'maplibre-gl';

import GeoJsonPreviewer from './geojson';
import type { AddGeoJsonSourceObject } from './geojson';
import { withLabelPoints } from '../labels';
import { zoomToFit } from '../maps';
import type EsriFeatureLayerResource from '../resources/esri-feature-layer';

const NO_FEATURES: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

export default class EsriFeatureLayerPreviewer extends GeoJsonPreviewer {
  declare protected resource: EsriFeatureLayerResource;

  // Report drawing explicitly because scale-gated layers may never request a MapLibre tile.
  readonly reportsDrawing = true;

  protected getSourceId(): string {
    return `${this.resource.id}-esri-feature-layer`;
  }

  protected async createSources(): Promise<AddGeoJsonSourceObject[]> {
    return [
      {
        id: this.getSourceId(),
        type: 'geojson',
        data: NO_FEATURES,
      },
    ];
  }

  protected async zoomRange() {
    return await this.resource.getZoomRange();
  }

  async preview(): Promise<void> {
    await super.preview();
    await this.applyZoomFloor();
    this.watchCamera();
    await this.syncData();
  }

  async clearPreview(): Promise<void> {
    this.stopWatching();
    await super.clearPreview();
  }

  protected async applyZoomFloor() {
    this.minZoom = undefined;

    const { minzoom } = await this.resource.getZoomRange();
    if (minzoom === undefined) return;

    const bounds = await this.resource.getBounds();
    if (!bounds) return;

    const fit = zoomToFit(this.map, bounds);
    if (fit !== undefined && fit >= minzoom) this.minZoom = minzoom;
  }

  // Remove existing listeners before adding them because style rebuilds reuse this previewer.
  protected watchCamera() {
    this.map.off('zoomend', this.handleCameraChange);
    this.map.on('zoomend', this.handleCameraChange);
    this.map.off('remove', this.stopWatching);
    this.map.once('remove', this.stopWatching);
  }

  private stopWatching = () => {
    if (!this.map) return;
    this.map.off('zoomend', this.handleCameraChange);
    this.map.off('remove', this.stopWatching);
  };

  private handleCameraChange = () => {
    void this.syncData();
  };

  async expandFeatures(features: MapGeoJSONFeature[]) {
    return await this.resource.expandFeatures(await super.expandFeatures(features));
  }

  protected async syncData(): Promise<void> {
    if (!this.attached) return;

    const { minzoom, maxzoom } = await this.resource.getZoomRange();
    const zoom = this.map.getZoom();

    if (minzoom !== undefined && zoom < minzoom) return this.settle('Zoom in to see this layer’s features.');
    if (maxzoom !== undefined && zoom >= maxzoom) return this.settle('Zoom out to see this layer’s features.');

    const data = await this.resource.getData();

    if (!this.attached) return;

    const source = this.map.getSource(this.getSourceId()) as GeoJSONSource | undefined;
    source?.setData(withLabelPoints(data));

    this.onNotice?.(this.resource.truncated ? `Showing the first ${this.resource.featuresRead.toLocaleString()} features of this layer.` : undefined);
  }

  private settle(notice: string) {
    this.onNotice?.(notice);
    this.onDrawn?.();
  }
}
