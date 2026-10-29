import type { LngLatBoundsLike } from 'maplibre-gl';

import RasterResource from './raster';
import { esriExtentToBounds, fetchEsriJson, splitEsriLayerUrl, type EsriMetadata } from '../esri';
import type { PixelWindow } from '../geometry';
import type { RequestTransform } from '../request';

export const EXPORT_TILE_SIZE = 256;

export type EsriRasterSourceSpec = {
  tiles: string[];
  scheme?: 'xyz';
  tileSize: number;
  minzoom?: number;
  maxzoom?: number;
  bounds?: [number, number, number, number];
};

export default abstract class EsriResource extends RasterResource {
  protected serviceUrl: string;

  protected layerId?: string;

  private metadata: EsriMetadata;

  constructor(id: string, url: string, bounds?: LngLatBoundsLike, requestTransform?: RequestTransform) {
    super(id, url, bounds, requestTransform);
    const { serviceUrl, layerId } = splitEsriLayerUrl(url);
    this.serviceUrl = serviceUrl;
    this.layerId = layerId;
  }

  getScheme() {
    return undefined;
  }

  getTileSize() {
    return EXPORT_TILE_SIZE;
  }

  async getReportedBounds() {
    const metadata = await this.getMetadata();
    return esriExtentToBounds(metadata.fullExtent ?? metadata.extent);
  }

  async getRasterSourceSpec(): Promise<EsriRasterSourceSpec> {
    return { tiles: [this.getMapLibreSourceUrl()], tileSize: this.getTileSize() };
  }

  async canInspect(): Promise<boolean> {
    return false;
  }

  async inspect(_window: PixelWindow): Promise<GeoJSON.Feature[]> {
    return [];
  }

  protected async getMetadata(): Promise<EsriMetadata> {
    if (!this.metadata) this.metadata = await fetchEsriJson(this.serviceUrl, {}, this.requestTransform);
    return this.metadata;
  }

  protected exportParams(): Record<string, string> {
    return {
      bboxSR: '3857',
      imageSR: '3857',
      size: `${EXPORT_TILE_SIZE},${EXPORT_TILE_SIZE}`,
      format: 'png32',
      transparent: 'true',
      dpi: '96',
      f: 'image',
    };
  }

  protected exportUrl(endpoint: string, params: Record<string, string> = {}): string {
    const url = new URL(`${this.serviceUrl}/${endpoint}`);
    Object.entries({ ...this.exportParams(), ...params }).forEach(([key, value]) => url.searchParams.set(key, value));

    return `${url.toString()}&bbox={bbox-epsg-3857}`;
  }
}
