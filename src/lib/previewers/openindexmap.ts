import type { LayerSpecification } from 'maplibre-gl';

import GeoJsonPreviewer from './geojson';
import { previewStyleLayers } from './vector';
import type IndexMapMosaic from '../index-map-mosaic';
import type { MosaicHost } from '../index-map-mosaic';
import type { Layer, LayerState, PreviewStyleLayer } from '../layers';
import type { LegendEntry } from '../legend';
import { offersMosaic } from '../mosaic';
import type OpenIndexMapResource from '../resources/openindexmap';

const LABELS_SUFFIX = '-labels';

export default class OpenIndexMapPreviewer extends GeoJsonPreviewer {
  declare protected resource: OpenIndexMapResource;
  protected mosaic: IndexMapMosaic | undefined;
  private mosaicSearch: Promise<void> | undefined;
  private outlinesDrawn = false;
  protected outlineLayerId: string | undefined;

  protected getDefaultOpacity(): number {
    return this.style.boundsOpacity;
  }

  protected getLabelOpacity(): number {
    return this.style.opacity;
  }

  protected previewLayerTitle(_layerId: string): string {
    return 'Geometry';
  }

  async preview(): Promise<void> {
    this.outlinesDrawn = false;
    await super.preview();
    this.outlinesDrawn = true;

    if (this.mosaic) this.showMosaic(this.mosaic);
    this.mosaicSearch ??= this.findMosaic();
  }

  async clearPreview() {
    this.outlinesDrawn = false;
    this.mosaic?.clear();
    await super.clearPreview();
  }

  protected async createLayers(): Promise<LayerSpecification[]> {
    const layers = await super.createLayers();
    this.outlineLayerId = layers.find(layer => layer.type === 'line')?.id;
    return layers;
  }

  protected createPreviewLayers(layerId: string, geometry: LayerSpecification[], labels: LayerSpecification[]): Layer[] {
    return [
      ...super.createPreviewLayers(layerId, geometry, []),
      {
        id: `${this.previewLayerId(layerId)}${LABELS_SUFFIX}`,
        title: 'Sheet labels',
        defaultOpacity: this.getLabelOpacity(),
        styleLayers: previewStyleLayers(labels),
      },
    ];
  }

  private async findMosaic() {
    const mosaic = await this.loadMosaic();
    if (!mosaic) return;

    this.mosaic = mosaic;
    if (!this.outlinesDrawn) return;

    this.showMosaic(mosaic);
    this.onLayersChanged?.();
  }

  protected async loadMosaic(): Promise<IndexMapMosaic | undefined> {
    try {
      const collection = await this.resource.getData();
      if (!offersMosaic(collection)) return undefined;

      const mosaic = await this.createMosaic(collection);
      return (await mosaic.canDraw()) ? mosaic : undefined;
    } catch (error) {
      console.warn(`Could not draw a mosaic of ${this.url}:`, error);
      return undefined;
    }
  }

  protected async createMosaic(collection: unknown): Promise<IndexMapMosaic> {
    const { default: Mosaic } = await import('../index-map-mosaic');
    return new Mosaic(this.resource, collection);
  }

  private showMosaic(mosaic: IndexMapMosaic) {
    if (!this.findPreviewLayer(mosaic.id)) {
      const labels = this.previewLayers.findIndex(layer => layer.id.endsWith(LABELS_SUFFIX));
      this.previewLayers.splice(labels < 0 ? this.previewLayers.length : labels, 0, mosaic.createRow(this.style));
    }

    mosaic.attach(this.mosaicHost()).draw();
  }

  private mosaicHost(): MosaicHost {
    return {
      map: this.map,
      style: this.style,
      beforeId: () => (this.outlineLayerId && this.map.getLayer(this.outlineLayerId) ? this.outlineLayerId : this.resolvedBeforeId),
      layersChanged: () => this.onLayersChanged?.(),
      notice: notice => this.onNotice?.(notice),
      loading: loading => this.onLoading?.(loading),
    };
  }

  protected applyStyleLayerState(styleLayer: PreviewStyleLayer, state: LayerState) {
    if (this.mosaic && styleLayer.id === this.mosaic.id) return this.mosaic.applyState(state);
    super.applyStyleLayerState(styleLayer, state);
  }

  get visibleLayerIds(): string[] {
    return super.visibleLayerIds.filter(id => id !== this.mosaic?.id);
  }

  get legendEntries(): LegendEntry[] {
    if (!this.attached || !this.boundariesDrawn) return [];

    return [
      { label: 'Available map', color: this.style.dataColor },
      { label: 'Unavailable map', color: this.style.invalidColor },
      { label: 'Selected map', color: this.style.selectedColor },
    ];
  }

  private get boundariesDrawn(): boolean {
    return this.previewLayers.some(layer => !layer.id.endsWith(LABELS_SUFFIX) && layer.id !== this.mosaic?.id && this.layerDrawn(layer.id));
  }
}
