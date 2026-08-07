import type { LngLatBoundsLike } from 'maplibre-gl';

import RasterResource from './raster';
import { esriExtentToBounds, fetchEsriJson, splitEsriLayerUrl, type EsriMetadata } from '../esri';
import type { PixelWindow } from '../geometry';
import type { RequestTransform } from '../request';

// ArcGIS draws an export image at whatever size we ask for, so this is just the size of the tiles
// MapLibre stitches them into. 256 keeps each request cheap enough to redraw while panning.
export const EXPORT_TILE_SIZE = 256;

// What a MapLibre raster source needs, in the parts that differ between ArcGIS services: an export
// request is a single templated URL drawn at a fixed size, while a cached tileset has a scheme, a
// zoom range and an extent outside of which there are no tiles to ask for.
export type EsriRasterSourceSpec = {
  tiles: string[];
  scheme?: 'xyz';
  tileSize: number;
  minzoom?: number;
  maxzoom?: number;
  bounds?: [number, number, number, number];
};

// Raster data ArcGIS draws for us, from a MapServer or an ImageServer. Subclasses build the request
// that fetches an image; reading the service's own description of itself lives here.
export default abstract class EsriResource extends RasterResource {
  // The service the requests go to, with any layer ID split off the end of the reference URL
  protected serviceUrl: string;

  // The single layer this reference points at, when it names one rather than the whole service
  protected layerId?: string;

  // Memoized service description, fetched from the REST endpoint
  private metadata: EsriMetadata;

  constructor(id: string, url: string, bounds?: LngLatBoundsLike, requestTransform?: RequestTransform) {
    super(id, url, bounds, requestTransform);
    const { serviceUrl, layerId } = splitEsriLayerUrl(url);
    this.serviceUrl = serviceUrl;
    this.layerId = layerId;
  }

  // An export image covers exactly the bbox it was asked for, so there's no tiling scheme to name
  getScheme() {
    return undefined;
  }

  getTileSize() {
    return EXPORT_TILE_SIZE;
  }

  // Used to zoom the map to the data once loaded. ArcGIS publishes the extent it can draw, which
  // is a good fallback when the record didn't carry a bounding box of its own.
  async getBounds() {
    if (this.bounds) return this.bounds;
    const metadata = await this.getMetadata();
    return esriExtentToBounds(metadata.fullExtent ?? metadata.extent);
  }

  // How the previewer should build its MapLibre source. Most services are drawn by asking for an
  // export image at the bbox MapLibre wants; a cached tileset overrides this.
  async getRasterSourceSpec(): Promise<EsriRasterSourceSpec> {
    return { tiles: [this.getMapLibreSourceUrl()], tileSize: this.getTileSize() };
  }

  // Whether the service will answer a request about what lies under a click. Services that only
  // hand back pre-rendered tiles won't, so the previewer asks before offering to inspect.
  async canInspect(): Promise<boolean> {
    return false;
  }

  // Features under the given window, as GeoJSON in EPSG:3857 - the coordinate system the request
  // asks for, which the previewer converts to degrees before drawing.
  async inspect(_window: PixelWindow): Promise<GeoJSON.Feature[]> {
    return [];
  }

  // Fetch and memoize the service description
  protected async getMetadata(): Promise<EsriMetadata> {
    if (!this.metadata) this.metadata = await fetchEsriJson(this.serviceUrl, {}, this.requestTransform);
    return this.metadata;
  }

  // Params shared by the MapServer /export and ImageServer /exportImage requests. Both draw into
  // the Web Mercator grid MapLibre uses, at the tile size it expects, over a transparent
  // background so the basemap shows through wherever the layer has nothing to draw.
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

  // An export URL for MapLibre to fill in the bbox of as it fetches each tile
  protected exportUrl(endpoint: string, params: Record<string, string> = {}): string {
    const url = new URL(`${this.serviceUrl}/${endpoint}`);
    Object.entries({ ...this.exportParams(), ...params }).forEach(([key, value]) => url.searchParams.set(key, value));

    // MapLibre has to see the braces to substitute the bbox, so this param can't be encoded
    return `${url.toString()}&bbox={bbox-epsg-3857}`;
  }
}
