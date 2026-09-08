import type { LayerSpecification, LineLayerSpecification, SourceSpecification, SymbolLayerSpecification, VectorSourceSpecification } from 'maplibre-gl';

import TiledVectorPreviewer from './tiled-vector';
import { featureTileToken, registerFeatureTiler, unregisterFeatureTiler } from '../esri-features';
import { ESRI_VECTOR_LAYER } from '../esri';
import { boundsToGeoJSON, readBounds } from '../geometry';
import type EsriFeatureLayerResource from '../resources/esri-feature-layer';

// MapLibre doesn't bundle the id with the source, but we need to
type AddSourceObject = SourceSpecification & { id: string };
type AddVectorSourceObject = VectorSourceSpecification & { id: string };

// A feature layer too large to hand a browser whole, drawn from tiles cut out of the service one
// view at a time. Each tile is one query scoped to its own box, so what is read is what is on
// screen rather than however many features the layer happened to list first - and MapLibre gets to
// cache them, drop them, and cancel the ones a reader has already panned away from.
//
// The layer's own scale window still applies, through VectorPreviewer's style layers; the source's
// own floor is a second, blunter one, for the layers - most of them - that publish no window at all.
export default class EsriTiledFeatureLayerPreviewer extends TiledVectorPreviewer {
  declare protected resource: EsriFeatureLayerResource;

  // Below the zoom its tiles start at, MapLibre asks for none of them and so reports none, and the
  // load deadline would expire on a preview doing exactly what it was asked to. So this one says
  // for itself when it is as drawn as it is going to get, the way the previews that paint their own
  // WebGL do.
  readonly reportsDrawing = true;

  // The zoom the tiles begin at, learned from the source spec and needed again for the outline
  // drawn in their place below it
  private tileMinzoom = 0;

  // How the tile protocol finds its way back to this resource. Distinct per previewer, because two
  // viewers of the same record on one page can carry different request transforms.
  private readonly token = featureTileToken(this.getSourceId());

  // The same id the untiled previewer uses, so a record that flips between the two - a layer that
  // grew past what a browser will hold - keeps one identity everywhere downstream
  protected getSourceId(): string {
    return `${this.resource.id}-esri-feature-layer`;
  }

  // 'esri' is a name of ours, not a publisher's: a tileset that names its own layers is worth
  // showing those names for, but humanizing this one would title the panel row "Esri" where it
  // should say what the reference is. Back to the resource's own label, as VectorPreviewer has it.
  protected previewLayerTitle(): string {
    return this.resource.label();
  }

  protected async zoomRange() {
    return await this.resource.getZoomRange();
  }

  protected async createSources(): Promise<AddVectorSourceObject[]> {
    // Before the source goes on the map, and safe to repeat: a theme change draws the same preview
    // again into a rebuilt style document without clearing it first
    registerFeatureTiler(this.token, this.resource);

    const spec = await this.resource.getVectorSourceSpec(this.token);
    this.tileMinzoom = spec.minzoom;

    const sources: AddSourceObject[] = [{ id: this.getSourceId(), type: 'vector', ...spec }];

    // Where the layer is, for the zooms its features aren't drawn at. Without this a record whose
    // extent needs a camera further out than its tiles begin at opens on a blank map: a reader is
    // told to zoom in with nothing on screen saying where to zoom in to.
    const outline = await this.getExtentOutline();
    if (outline) sources.push({ id: this.extentSourceId, type: 'geojson', data: outline });

    return sources as AddVectorSourceObject[];
  }

  // The tiles, plus the outline that stands in for them further out. Both in one panel row: the
  // outline is machinery for reading the layer rather than a layer of its own, so it is flagged
  // internal and neither listed separately nor faded by the opacity slider - the same arrangement
  // InspectableRasterPreviewer uses for its highlight.
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

  // The tiles are reported by the map's own events once they start arriving; further out, where
  // there are none to arrive, this preview is already as drawn as it gets
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

  // Taken off first, so a theme change - which draws this preview again into a rebuilt style
  // document with no clearPreview between - leaves one listener rather than two. And on the map's
  // own teardown as well, because clearPreview is not reached on every path a preview comes down by.
  protected watchCamera() {
    this.map.off('zoomend', this.handleCameraChange);
    this.map.on('zoomend', this.handleCameraChange);

    // Whether a tile came back short is only known once it has come back, which is after the zoom
    // that asked for it ended - so the camera alone would say it a whole interaction late, and go
    // on saying it after the reader has zoomed past the point where it was true
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

  // Say why nothing is drawn, or that what is drawn is only part of the layer. Either way the
  // preview has done all it can from here, so the deadline stops waiting on a tile that a zoom
  // this far out will never ask for.
  protected syncNotice() {
    if (!this.attached) return;

    if (this.map.getZoom() < this.tileMinzoom) {
      this.onNotice?.('Zoom in to see this layer’s features.');
      this.onDrawn?.();
      return;
    }

    // Only while the reader is still at or outside a zoom the service would not answer in full.
    // Further in, the tiles fit and there is nothing left out to warn about.
    const capped = this.resource.cappedAtZoom;
    this.onNotice?.(capped !== undefined && this.map.getZoom() <= capped ? 'Zoom in — some features are left out at this zoom.' : undefined);
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

  // Both of these stop exactly where the tiles start, so the outline gives way to the features
  // rather than being drawn under them
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

  // The tiles carry only what the map draws with, so a click asks the service for the rest
  async expandFeatures(features: maplibregl.MapGeoJSONFeature[]) {
    return await this.resource.expandFeatures(features);
  }
}
