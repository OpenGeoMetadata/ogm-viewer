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

  // Time domain tracking for layers that provide it
  private times = new Map<string, WmtsTime>();
  private fullDomains = new Map<string, TimeDomain>();
  private domainRequests = new Set<string>();
  private drawnTimes = new Map<string, string>();
  private reloading = new Set<string>();
  private queuedTimes = new Map<string, string>();

  // WMTS sources have multiple XYZ tile URLs for fallbacks, and each layer
  // can have different tile size, zoom range, bounds, times, etc.
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

  // One layer per source, with the same ID as the source. Each is its own row in the layer
  // control, titled from the <ows:Title> the service published for people to read rather than the
  // identifier it uses to address the layer, and carrying whatever legend its style publishes - and the
  // times it can be drawn at, for a layer with a choice of them.
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

  // The user's choices, including the one that isn't a paint property: another time is another set of
  // tiles. Cheap to call again with nothing changed, which is how it's called - on every frame of an
  // opacity drag - since a time already drawn or on its way is left alone.
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

  // Read the rest of a layer's times from its service's domains document, once, and hand them to its
  // row. Along with the ones its capabilities listed rather than in place of them: the two documents are
  // read at different moments, and a layer kept up to date can gain a time in between.
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

  // Point a layer's source at its tiles for another time.
  //
  // MapLibre swaps a source's tiles in place - each keeps showing what it had until its replacement
  // arrives, so the map doesn't blank between one time and the next - but it doesn't cancel what it had
  // already asked for. A tile told to reload before its last reload has landed has two requests out, and
  // shows whichever answers last, so stepping back three days in quick succession could leave the map a
  // patchwork of all three. So each source has one reload under way at a time: a time asked for while one
  // is waits for the map to go idle - every tile it wanted in, or failed - and only the latest of those
  // that waited is drawn then. The control says the time asked for at once; the map catches up.
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
      // The style was rebuilt in the meantime, and this source with it. The one that replaced it started
      // over at its default, and the state it has is its own.
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
