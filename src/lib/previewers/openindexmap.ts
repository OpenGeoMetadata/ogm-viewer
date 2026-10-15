import type { LayerSpecification } from 'maplibre-gl';

import GeoJsonPreviewer from './geojson';
import type IndexMapMosaic from './mosaic';
import type { MosaicHost } from './mosaic';
import { previewStyleLayers } from './vector';
import type { Layer, LayerState, PreviewStyleLayer } from '../layers';
import type { LegendEntry } from '../legend';
import { offersMosaic } from '../mosaic';
import type OpenIndexMapResource from '../resources/openindexmap';

const LABELS_SUFFIX = '-labels';

export default class OpenIndexMapPreviewer extends GeoJsonPreviewer {
  declare protected resource: OpenIndexMapResource;

  // The sheets drawn as one mosaic, for an index map whose sheets link COGs, once one has been found.
  // An extra layer of this preview rather than a preview of its own: the outlines are drawn first, as
  // they always are, and the mosaic joins them in the panel once its first sheet has been read.
  protected mosaic: IndexMapMosaic | undefined;

  // The look for one, made once per preview rather than once per draw: what an index map links doesn't
  // change with the basemap
  private mosaicSearch: Promise<void> | undefined;

  // Whether the outlines are on the map, which is when a mosaic found late can join them. False while a
  // draw is under way, so one found mid-draw waits for the list of rows the draw is still building.
  private outlinesDrawn = false;

  // The outline layer the mosaic is drawn underneath, once the outlines are on the map
  protected outlineLayerId: string | undefined;

  // Starts fainter than a regular vector would; we don't care as much about
  // the geometry because it's just showing where the sheets are.
  protected getDefaultOpacity(): number {
    return this.style.boundsOpacity;
  }

  // The labels are the exception; they need to be readable, so they use the
  // default theme opacity instead of the more transparent one.
  protected getLabelOpacity(): number {
    return this.style.opacity;
  }

  // Title for the layer group actually controls the polygons, in the layers
  // browser.
  protected previewLayerTitle(_layerId: string): string {
    return 'Geometry';
  }

  // Draw the outlines, and then whatever mosaic of the sheets there is. Not waited on: the outlines are
  // the index map, and a mosaic is a header read and a chunk of deck.gl away from being known about.
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

  // The polygons' outline is the first line layer VectorPreviewer builds: everything before it is a
  // fill, and the mosaic goes over those but under the outlines and the selected sheet's highlight
  protected async createLayers(): Promise<LayerSpecification[]> {
    const layers = await super.createLayers();
    this.outlineLayerId = layers.find(layer => layer.type === 'line')?.id;
    return layers;
  }

  // Split the geometry and labels into separate layer groups that can be
  // toggled/faded separately. This allows hiding the labels when they're too
  // dense and crowding the preview.
  protected createPreviewLayers(layerId: string, geometry: LayerSpecification[], labels: LayerSpecification[]): Layer[] {
    return [
      // The ordinary row, minus the labels that have been taken out of it
      ...super.createPreviewLayers(layerId, geometry, []),
      {
        id: `${this.previewLayerId(layerId)}${LABELS_SUFFIX}`,
        title: 'Sheet labels',
        defaultOpacity: this.getLabelOpacity(),
        styleLayers: previewStyleLayers(labels),
      },
    ];
  }

  // Look for a mosaic, and add it to the map if the outlines are already there. Never rejects: a
  // mosaic that can't be had is an index map drawn the way it always was.
  private async findMosaic() {
    const mosaic = await this.loadMosaic();
    if (!mosaic) return;

    this.mosaic = mosaic;
    if (!this.outlinesDrawn) return;

    this.showMosaic(mosaic);
    this.onLayersChanged?.();
  }

  // A mosaic of the sheets, if the index map is worth one and its first sheet reads as a COG. Read from
  // the GeoJSON the outlines were drawn from, which costs nothing more; only an index map that links
  // GeoTIFFs goes on to load deck.gl and read a header.
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

  // Loaded on demand, like a COG preview, since it's what pulls in deck.gl. A method of its own so a
  // test can hand over a mosaic of its own.
  protected async createMosaic(collection: unknown): Promise<IndexMapMosaic> {
    const { default: Mosaic } = await import('./mosaic');
    return new Mosaic(this.resource, collection);
  }

  // List the mosaic between the outlines and their labels, which is where it's drawn, and draw it.
  // Listed again on every draw, since every draw starts its list over.
  private showMosaic(mosaic: IndexMapMosaic) {
    if (!this.findPreviewLayer(mosaic.id)) {
      const labels = this.previewLayers.findIndex(layer => layer.id.endsWith(LABELS_SUFFIX));
      this.previewLayers.splice(labels < 0 ? this.previewLayers.length : labels, 0, mosaic.createRow(this.style));
    }

    mosaic.attach(this.mosaicHost()).draw();
  }

  // What the mosaic needs of this preview, read when it's needed: ogm-map hands over its hooks afresh
  // on every load
  private mosaicHost(): MosaicHost {
    return {
      map: this.map,
      style: this.style,
      // Checked against the map first, as MapPreviewer's own is, and the basemap's anchor if the
      // outlines aren't there
      beforeId: () => (this.outlineLayerId && this.map.getLayer(this.outlineLayerId) ? this.outlineLayerId : this.resolvedBeforeId),
      layersChanged: () => this.onLayersChanged?.(),
      notice: notice => this.onNotice?.(notice),
    };
  }

  // MapLibre knows nothing of the mosaic's row, so it's handed to deck.gl instead; every other row is
  // a style layer of the outlines and goes the usual way
  protected applyStyleLayerState(styleLayer: PreviewStyleLayer, state: LayerState) {
    if (this.mosaic && styleLayer.id === this.mosaic.id) return this.mosaic.applyState(state);
    super.applyStyleLayerState(styleLayer, state);
  }

  // Never the mosaic's row: a rendered-feature query naming a layer the style doesn't hold comes back
  // empty for every layer it names, and the outlines are what a click is meant to find
  get visibleLayerIds(): string[] {
    return super.visibleLayerIds.filter(id => id !== this.mosaic?.id);
  }

  // Legend that shows what the colors mean.
  get legendEntries(): LegendEntry[] {
    if (!this.attached || !this.boundariesDrawn) return [];

    return [
      { label: 'Available map', color: this.style.dataColor },
      { label: 'Unavailable map', color: this.style.invalidColor },
      { label: 'Selected map', color: this.style.selectedColor },
    ];
  }

  // Used to hide the legend if the geometry isn't being shown, since it would
  // be meaningless if it doesn't correspond to anything on the map. Neither
  // the labels nor a mosaic of the sheets is the geometry.
  private get boundariesDrawn(): boolean {
    return this.previewLayers.some(layer => !layer.id.endsWith(LABELS_SUFFIX) && layer.id !== this.mosaic?.id && this.layerDrawn(layer.id));
  }
}
