import type { LayerSpecification, LineLayerSpecification, MapGeoJSONFeature, SourceSpecification, SymbolLayerSpecification, VectorSourceSpecification } from 'maplibre-gl';

import TiledVectorPreviewer from './tiled-vector';
import { featureTileToken, registerFeatureTiler, unregisterFeatureTiler } from '../esri-features';
import { ESRI_VECTOR_LAYER } from '../esri';
import { boundsToGeoJSON, readBounds } from '../geometry';
import type EsriFeatureLayerResource from '../resources/esri-feature-layer';

type AddSourceObject = SourceSpecification & { id: string };
type AddVectorSourceObject = VectorSourceSpecification & { id: string };

export default class EsriTiledFeatureLayerPreviewer extends TiledVectorPreviewer {
  declare protected resource: EsriFeatureLayerResource;

  // Report drawing explicitly when the view is too distant to request any tiles.
  readonly reportsDrawing = true;

  private tileMinzoom = 0;

  private readonly token = featureTileToken(this.getSourceId());

  protected getSourceId(): string {
    return `${this.resource.id}-esri-feature-layer`;
  }

  protected previewLayerTitle(): string {
    return this.resource.label();
  }

  protected async zoomRange() {
    return await this.resource.getZoomRange();
  }

  protected async createSources(): Promise<AddVectorSourceObject[]> {
    registerFeatureTiler(this.token, this.resource);

    const spec = await this.resource.getVectorSourceSpec(this.token);
    this.tileMinzoom = spec.minzoom;

    const sources: AddSourceObject[] = [{ id: this.getSourceId(), type: 'vector', ...spec }];

    // Show the extent below the tile zoom floor so the user can see where to zoom in.
    const outline = await this.getExtentOutline();
    if (outline) sources.push({ id: this.extentSourceId, type: 'geojson', data: outline });

    return sources as AddVectorSourceObject[];
  }

  protected async createLayers(): Promise<LayerSpecification[]> {
    const layers = await super.createLayers();
    if (!this.map.getSource(this.extentSourceId)) return layers;

    const count = await this.resource.getFeatureCount();
    const extras = [this.createExtentOutlineLayer(), this.createExtentLabelLayer(count)];

    this.findPreviewLayer(this.previewLayerId(ESRI_VECTOR_LAYER))?.styleLayers.push(
      { id: extras[0].id, type: 'line', internal: true },
      { id: extras[1].id, type: 'symbol', internal: true },
    );

    return [...layers, ...extras];
  }

  async preview(): Promise<void> {
    await super.preview();
    this.watchCamera();
    this.syncNotice();
  }

  async clearPreview(): Promise<void> {
    this.stopWatching();
    unregisterFeatureTiler(this.token);
    await super.clearPreview();

    if (this.attached && this.map.getSource(this.extentSourceId)) this.map.removeSource(this.extentSourceId);
  }

  protected watchCamera() {
    this.map.off('zoomend', this.handleCameraChange);
    this.map.on('zoomend', this.handleCameraChange);

    // Tile truncation is known after zoomend; refresh the notice once the tile requests settle.
    this.map.off('idle', this.handleCameraChange);
    this.map.on('idle', this.handleCameraChange);

    this.map.off('remove', this.stopWatching);
    this.map.once('remove', this.stopWatching);
  }

  private stopWatching = () => {
    if (!this.map) return;
    this.map.off('zoomend', this.handleCameraChange);
    this.map.off('idle', this.handleCameraChange);
    this.map.off('remove', this.stopWatching);
  };

  private handleCameraChange = () => this.syncNotice();

  protected syncNotice() {
    if (!this.attached) return;

    if (this.map.getZoom() < this.tileMinzoom) {
      this.onNotice?.('Zoom in to see this layer’s features.');
      this.onDrawn?.();
      return;
    }

    const capped = this.resource.cappedTiles;
    const truncated = capped && this.map.getZoom() <= capped.zoom;

    this.onNotice?.(truncated ? `Features are truncated to ${capped.limit.toLocaleString()} per tile at this zoom level.` : undefined);
  }

  protected get extentSourceId(): string {
    return `${this.getSourceId()}-extent`;
  }

  private async getExtentOutline(): Promise<GeoJSON.Feature | undefined> {
    const extent = await this.resource.getBounds();
    if (!extent) return undefined;

    const bounds = readBounds(extent);
    if (!bounds) return undefined;

    return { type: 'Feature', geometry: boundsToGeoJSON(bounds) as GeoJSON.Geometry, properties: {} };
  }

  private createExtentOutlineLayer(): LineLayerSpecification {
    return {
      id: `${this.extentSourceId}-outline`,
      type: 'line',
      source: this.extentSourceId,
      maxzoom: this.tileMinzoom,
      layout: { visibility: 'visible' },
      paint: {
        'line-color': this.style.strokeColor,
        'line-width': 1,
        'line-dasharray': [3, 2],
        'line-opacity': this.getDefaultOpacity(),
      },
    };
  }

  private createExtentLabelLayer(count?: number): SymbolLayerSpecification {
    return {
      id: `${this.extentSourceId}-label`,
      type: 'symbol',
      source: this.extentSourceId,
      maxzoom: this.tileMinzoom,
      layout: {
        'visibility': 'visible',
        'text-field': count ? `Zoom in to see ${count.toLocaleString()} features` : 'Zoom in to see this layer’s features',
        'text-font': [this.style.textFont],
        'text-size': this.style.textSize,
      },
      paint: {
        'text-color': this.style.textColor,
        'text-halo-color': this.style.textHaloColor,
        'text-halo-width': 1,
        'text-opacity': this.getLabelOpacity(),
      },
    };
  }

  async expandFeatures(features: MapGeoJSONFeature[]) {
    return await this.resource.expandFeatures(features);
  }
}
