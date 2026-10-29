import RasterPreviewer from './raster';
import type WmtsResource from '../resources/wmts';
import type { WmtsLayer, WmtsTime } from '../resources/wmts';
import type { AddRasterSourceObject } from './raster';
import type { RasterLayerSpecification, RasterTileSource } from 'maplibre-gl';
import { resolveLayerState, type LayerState } from '../layers';
import TimeDomain from '../time';

export default class WmtsPreviewer extends RasterPreviewer {
  declare protected resource: WmtsResource;
  protected layers: WmtsLayer[];

  private times = new Map<string, WmtsTime>();
  private fullDomains = new Map<string, TimeDomain>();
  private domainRequests = new Set<string>();
  private drawnTimes = new Map<string, string>();
  private reloading = new Set<string>();
  private queuedTimes = new Map<string, string>();

  protected async createSources(): Promise<AddRasterSourceObject[]> {
    const layers = await this.resource.getLayers();

    this.times = new Map(layers.flatMap(layer => (layer.time ? [[this.layerId(layer), layer.time]] : [])));
    this.times.forEach((time, id) => {
      if (this.map.getSource(id)) return;
      this.drawnTimes.set(id, time.default);
      this.reloading.delete(id);
      this.queuedTimes.delete(id);
    });

    return layers.map(layer => ({
      id: this.layerId(layer),
      type: 'raster',
      tiles: layer.tileUrls,
      scheme: this.resource.getScheme(),
      tileSize: layer.tileSize,
      minzoom: layer.minzoom,
      maxzoom: layer.maxzoom,
      ...(layer.bounds && { bounds: layer.bounds }),
    }));
  }

  protected async createLayers(): Promise<RasterLayerSpecification[]> {
    const layers = await this.resource.getLayers();

    return layers.map(layer => {
      const id = this.layerId(layer);

      this.previewLayers.push({
        id,
        title: layer.title?.trim() || layer.id,
        defaultOpacity: this.style.opacity,
        styleLayers: [{ id, type: 'raster' }],
        ...(layer.legendImages && { legendImages: layer.legendImages }),
        ...(layer.time && { defaultTime: layer.time.default, timeDomain: this.fullDomains.get(id) ?? TimeDomain.parse(layer.time.values) }),
      });

      return {
        id,
        type: 'raster' as const,
        source: id,
        layout: {
          visibility: 'visible' as const,
        },
        paint: {
          'raster-opacity': this.style.opacity,
        },
      };
    });
  }

  applyLayerState(states: ReadonlyMap<string, LayerState>) {
    super.applyLayerState(states);

    this.previewLayers.forEach(layer => {
      const { time } = resolveLayerState(layer, states);
      if (time !== undefined && this.times.has(layer.id)) this.showTime(layer.id, time);
    });
  }

  async clearPreview() {
    await super.clearPreview();
    this.drawnTimes.clear();
    this.reloading.clear();
    this.queuedTimes.clear();
  }

  loadTimeDomain(id: string): void {
    const time = this.times.get(id);
    if (!time?.domainsUrl || this.domainRequests.has(id)) return;
    this.domainRequests.add(id);

    this.resource
      .fetchTimeValues(time)
      .then(values => {
        if (!values) return;
        const domain = TimeDomain.parse([...time.values, ...values]);
        this.fullDomains.set(id, domain);

        const row = this.findPreviewLayer(id);
        if (!row) return;
        row.timeDomain = domain;
        this.onLayersChanged?.();
      })
      .catch(error => console.warn(`Could not read every time ${time.domainsUrl} describes, so only the ones its capabilities list can be chosen:`, error));
  }

  // Serialize time reloads because MapLibre lets overlapping requests finish out of order.
  // Keep only the latest queued time while the current reload finishes.
  private showTime(id: string, time: string) {
    if (this.reloading.has(id)) {
      this.queuedTimes.set(id, time);
      return;
    }

    this.queuedTimes.delete(id);
    if (this.drawnTimes.get(id) === time) return;

    const source = this.map.getSource<RasterTileSource>(id);
    const dimension = this.times.get(id);
    if (!source || !dimension) return;

    source.setTiles(dimension.templates.map(template => template.replaceAll(`{${dimension.identifier}}`, time)));
    this.drawnTimes.set(id, time);
    this.reloading.add(id);

    this.map.once('idle', () => {
      if (this.map.getSource(id) !== source) return;

      this.reloading.delete(id);
      const queued = this.queuedTimes.get(id);
      if (queued !== undefined) this.showTime(id, queued);
    });
  }

  private layerId(layer: WmtsLayer): string {
    return `${this.resource.id}-${layer.id}`;
  }
}
