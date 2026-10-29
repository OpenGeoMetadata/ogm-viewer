import { type LngLatBoundsLike } from 'maplibre-gl';
import RasterResource from './raster';
import type { ResourceKind } from './resource';
import type { PixelWindow } from '../geometry';
import { resolveRequest, type RequestTransform } from '../request';

type WmsOptions = {
  layerIds: string[];
  bbox?: string; // minx,miny,maxx,maxy in EPSG:3857
  crs?: string;
  tileSize?: number;
  format?: string;
  styles?: string;
  transparent?: boolean;
  version?: string;
  infoFormat?: string;
};

export type GetFeatureInfoOptions = PixelWindow;

const DEFAULT_FEATURE_COUNT = 10;

const GEOJSON_INFO_FORMATS = ['application/geo+json', 'application/vnd.geo+json', 'application/json'];

const DEFAULT_INFO_FORMAT = 'application/json';

const defaultWmsOptions: WmsOptions = {
  layerIds: [],
  bbox: '{bbox-epsg-3857}',
  crs: 'EPSG:3857',
  tileSize: 256,
  format: 'image/png',

  styles: '',
  transparent: true,
  version: '1.3.0',
};

export default class WmsResource extends RasterResource {
  readonly kind: ResourceKind = 'wms';

  private options: WmsOptions;

  private metadata: Document;

  private publishedInfoFormats?: string[] | null;

  constructor(id: string, url: string, options: WmsOptions, bounds?: LngLatBoundsLike, requestTransform?: RequestTransform) {
    super(id, url, bounds, requestTransform);
    this.options = { ...defaultWmsOptions, ...options };

    if (!this.options.layerIds || this.options.layerIds.length === 0) {
      this.options.layerIds = [id];
    }
  }

  label() {
    return 'Web Map Service (WMS)';
  }

  protected async getMetadata() {
    if (!this.metadata) {
      const { url, init } = resolveRequest(this.capabilitiesUrl, 'metadata', this.requestTransform);
      const resp = await fetch(url, init);
      const text = await resp.text();
      this.metadata = new DOMParser().parseFromString(text, 'application/xml');
    }
    return this.metadata;
  }

  getMapLibreSourceUrl() {
    return this.tilesUrl;
  }

  getScheme() {
    return undefined;
  }

  getTileSize() {
    return this.options.tileSize as number;
  }

  async inspect(options: GetFeatureInfoOptions) {
    const { url, init } = resolveRequest(await this.inspectUrl(options), 'metadata', this.requestTransform);
    return await fetch(url, init);
  }

  async canInspect(): Promise<boolean> {
    if (this.options.infoFormat) return true;
    const formats = await this.getPublishedInfoFormats();
    return formats === null || GEOJSON_INFO_FORMATS.some(format => formats.includes(format));
  }

  protected async getInfoFormat(): Promise<string> {
    if (this.options.infoFormat) return this.options.infoFormat;
    const formats = (await this.getPublishedInfoFormats()) ?? [];
    return GEOJSON_INFO_FORMATS.find(format => formats.includes(format)) ?? DEFAULT_INFO_FORMAT;
  }

  protected async getPublishedInfoFormats(): Promise<string[] | null> {
    if (this.publishedInfoFormats === undefined) {
      try {
        const metadata = await this.getMetadata();
        if (!metadata.querySelector('Capability > Request')) throw new Error('The capabilities list no requests');
        this.publishedInfoFormats = Array.from(metadata.querySelectorAll('GetFeatureInfo > Format')).map(element => element.textContent?.trim());
      } catch (error) {
        console.warn(`Could not read the supported info formats from ${this.capabilitiesUrl}:`, error);
        this.publishedInfoFormats = null;
      }
    }
    return this.publishedInfoFormats;
  }

  protected get tilesUrl() {
    const tilesUrl = new URL(this.url);

    tilesUrl.searchParams.set('service', 'WMS');
    tilesUrl.searchParams.set('request', 'GetMap');
    tilesUrl.searchParams.set('layers', this.options.layerIds.join(','));
    tilesUrl.searchParams.set('width', String(this.options.tileSize));
    tilesUrl.searchParams.set('height', String(this.options.tileSize));
    tilesUrl.searchParams.set('transparent', String(this.options.transparent));
    tilesUrl.searchParams.set(this.isVersion130 ? 'crs' : 'srs', this.options.crs as string);
    tilesUrl.searchParams.set('format', this.options.format as string);
    tilesUrl.searchParams.set('styles', this.options.styles as string);
    tilesUrl.searchParams.set('version', this.options.version as string);

    let tilesUrlString = tilesUrl.toString();
    tilesUrlString += `&bbox=${this.options.bbox}`;

    return tilesUrlString;
  }

  protected async inspectUrl(inspectOptions: GetFeatureInfoOptions) {
    const inspectUrl = new URL(this.url);

    const options = { ...this.options, ...inspectOptions };

    inspectUrl.searchParams.set('service', 'WMS');
    inspectUrl.searchParams.set('request', 'GetFeatureInfo');
    inspectUrl.searchParams.set('info_format', await this.getInfoFormat());
    inspectUrl.searchParams.set('layers', options.layerIds.join(','));
    inspectUrl.searchParams.set('query_layers', options.layerIds.join(','));
    inspectUrl.searchParams.set('styles', options.styles as string);
    inspectUrl.searchParams.set('version', options.version as string);
    inspectUrl.searchParams.set('bbox', options.bbox as string);
    inspectUrl.searchParams.set('width', String(options.width));
    inspectUrl.searchParams.set('height', String(options.height));
    inspectUrl.searchParams.set('feature_count', String(DEFAULT_FEATURE_COUNT));

    if (this.isVersion130) {
      inspectUrl.searchParams.set('crs', options.crs as string);
      inspectUrl.searchParams.set('i', String(Math.round(options.x)));
      inspectUrl.searchParams.set('j', String(Math.round(options.y)));
    } else {
      inspectUrl.searchParams.set('srs', options.crs as string);
      inspectUrl.searchParams.set('x', String(Math.round(options.x)));
      inspectUrl.searchParams.set('y', String(Math.round(options.y)));
    }

    return inspectUrl.toString();
  }

  protected get isVersion130() {
    const [major, minor] = (this.options.version as string).split('.').map(Number);
    return major > 1 || (major === 1 && minor >= 3);
  }

  protected get capabilitiesUrl() {
    const capabilitiesUrl = new URL(this.url);
    capabilitiesUrl.searchParams.set('service', 'WMS');
    capabilitiesUrl.searchParams.set('request', 'GetCapabilities');
    capabilitiesUrl.searchParams.set('version', this.options.version as string);
    return capabilitiesUrl.toString();
  }
}
