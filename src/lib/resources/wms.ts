import { type LngLatBoundsLike } from 'maplibre-gl';
import RasterResource from './raster';

// Base params for WMS GetMap requests, which return raster tiles
type WmsOptions = {
  layerIds: string[];
  bbox?: string; // minx,miny,maxx,maxy in EPSG:3857
  crs?: string;
  tileSize?: number;
  format?: string;
  transparent?: boolean;
  version?: string;
};

// Additional required params when making a WMS GetFeatureInfo request. The bbox and
// the pixel grid describe each other: the grid is width x height pixels covering the
// bbox, and x,y picks the pixel in it to ask about.
export type GetFeatureInfoOptions = {
  bbox: string; // minx,miny,maxx,maxy in EPSG:3857 meters
  width: number; // grid width in pixels
  height: number; // grid height in pixels
  x: number; // column to inspect, counted from the left edge
  y: number; // row to inspect, counted from the top edge
};

// Number of features to ask for when inspecting; the spec defaults this to 1, which
// hides everything under the cursor but the topmost feature
const DEFAULT_FEATURE_COUNT = 10;

const defaultWmsOptions: WmsOptions = {
  layerIds: [],
  bbox: '{bbox-epsg-3857}',
  crs: 'EPSG:3857',
  tileSize: 256,
  format: 'image/png',
  transparent: true,
  version: '1.3.0',
};

// Data accessed via WMS GetMap requests, which return raster tiles
export default class WmsResource extends RasterResource {
  private options: WmsOptions;

  // Memoized metadata via GetCapabilities request
  private metadata: Document;

  constructor(id: string, url: string, options: WmsOptions, bounds?: LngLatBoundsLike) {
    super(id, url, bounds);
    this.options = { ...defaultWmsOptions, ...options };

    // Assume we're using one layer with the given ID if no layer IDs are provided
    if (!this.options.layerIds || this.options.layerIds.length === 0) {
      this.options.layerIds = [id];
    }
  }

  label() {
    return 'Web Map Service (WMS)';
  }

  // Fetch and memoize WMS GetCapabilities XML document
  protected async getMetadata() {
    if (!this.metadata) {
      const resp = await fetch(this.capabilitiesUrl);
      const text = await resp.text();
      this.metadata = new DOMParser().parseFromString(text, 'application/xml');
    }
    return this.metadata;
  }

  getMapLibreSourceUrl() {
    return this.tilesUrl;
  }

  // WMS has no specific scheme identifier for MapLibre
  getScheme() {
    return undefined;
  }

  getTileSize() {
    return this.options.tileSize as number;
  }

  async inspect(options: GetFeatureInfoOptions) {
    return await fetch(this.inspectUrl(options));
  }

  // WMS GetMap URL that will fetch tiles for this source
  protected get tilesUrl() {
    const tilesUrl = new URL(this.url);

    // Construct the WMS URL with required parameters
    // See: https://doc.esri.com/en/arcgis-enterprise/latest/administer/communicating-with-a-wms-service-in-a-web-browser.html?pivots=os-windows
    tilesUrl.searchParams.set('service', 'WMS');
    tilesUrl.searchParams.set('request', 'GetMap');
    tilesUrl.searchParams.set('layers', this.options.layerIds.join(','));
    tilesUrl.searchParams.set('width', String(this.options.tileSize));
    tilesUrl.searchParams.set('height', String(this.options.tileSize));
    tilesUrl.searchParams.set('transparent', String(this.options.transparent));
    tilesUrl.searchParams.set(this.isVersion130 ? 'crs' : 'srs', this.options.crs as string);
    tilesUrl.searchParams.set('format', this.options.format as string);
    tilesUrl.searchParams.set('version', this.options.version as string);

    // This param can't be encoded because MapLibre needs to template it
    let tilesUrlString = tilesUrl.toString();
    tilesUrlString += `&bbox=${this.options.bbox}`;

    return tilesUrlString;
  }

  // WMS GetFeatureInfo URL, used to fetch information about features at a specific point
  protected inspectUrl(inspectOptions: GetFeatureInfoOptions) {
    const inspectUrl = new URL(this.url);

    // Merge the provided options with the instance's options
    const options = { ...this.options, ...inspectOptions };

    inspectUrl.searchParams.set('service', 'WMS');
    inspectUrl.searchParams.set('request', 'GetFeatureInfo');
    inspectUrl.searchParams.set('info_format', 'application/json');
    inspectUrl.searchParams.set('layers', options.layerIds.join(','));
    inspectUrl.searchParams.set('query_layers', options.layerIds.join(','));
    inspectUrl.searchParams.set('version', options.version as string);
    inspectUrl.searchParams.set('bbox', options.bbox as string);
    inspectUrl.searchParams.set('width', String(options.width));
    inspectUrl.searchParams.set('height', String(options.height));
    inspectUrl.searchParams.set('feature_count', String(DEFAULT_FEATURE_COUNT));

    // 1.3.0 renamed SRS to CRS, and renamed the pixel coordinates X,Y to I,J. Servers
    // do enforce the names for the version they were asked for, so pick them to match.
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

  // Whether this source speaks WMS 1.3.0 or later, which changed some param names
  protected get isVersion130() {
    const [major, minor] = (this.options.version as string).split('.').map(Number);
    return major > 1 || (major === 1 && minor >= 3);
  }

  // WMS GetCapabilities URL, used to fetch metadata about the layers
  protected get capabilitiesUrl() {
    const capabilitiesUrl = new URL(this.url);
    capabilitiesUrl.searchParams.set('service', 'WMS');
    capabilitiesUrl.searchParams.set('request', 'GetCapabilities');
    capabilitiesUrl.searchParams.set('version', this.options.version as string);
    return capabilitiesUrl.toString();
  }
}
