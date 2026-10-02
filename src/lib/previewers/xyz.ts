import type { RasterTileSource } from 'maplibre-gl';

import RasterPreviewer, { type AddRasterSourceObject } from './raster';

// Works for both XYZ and TMS
export default class XyzPreviewer extends RasterPreviewer {
  // The deepest zoom a tile has arrived from
  private deepestLoaded?: number;
  private maxzoom?: number;

  protected async createSources(): Promise<AddRasterSourceObject[]> {
    const sources = await super.createSources();
    if (this.maxzoom === undefined) return sources;
    return sources.map(source => ({ ...source, maxzoom: this.maxzoom }));
  }

  tileLoaded(sourceId: string, zoom: number) {
    if (sourceId !== this.getSourceId()) return;
    this.deepestLoaded = Math.max(zoom, this.deepestLoaded ?? zoom);
  }

  absorbTileError(sourceId: string, zoom: number): boolean {
    if (sourceId !== this.getSourceId()) return false;
    if (this.deepestLoaded === undefined || zoom <= this.deepestLoaded) return false;
    this.holdAbove(zoom);
    return true;
  }

  // Hold the source one level above a zoom that failed
  private holdAbove(zoom: number) {
    const maxzoom = zoom - 1;
    if (this.maxzoom !== undefined && this.maxzoom <= maxzoom) return;
    this.maxzoom = maxzoom;

    const source = this.attached ? this.map.getSource<RasterTileSource>(this.getSourceId()) : undefined;
    if (!source) return;

    source.maxzoom = maxzoom;
    this.map._update();
  }
}
