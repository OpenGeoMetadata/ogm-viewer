import RasterSource from './raster';

type WmsOptions = {
  layerIds: string[];
  bbox?: string;
  srs?: string;
  tileSize?: number;
  format?: string;
  transparent?: boolean;
  version?: string;
};

const defaultOptions: WmsOptions = {
  layerIds: [],
  bbox: '{bbox-epsg-3857}',
  srs: 'EPSG:3857',
  tileSize: 256,
  format: 'image/png',
  transparent: true,
  version: '1.3.0',
};

// Data accessed via WMS GetMap requests, which return raster tiles
export default class WmsSource extends RasterSource {
  private options: WmsOptions;

  // Memoized metadata via GetCapabilities request
  private metadata: Document;

  constructor(id: string, url: string, options: WmsOptions) {
    super(id, url);
    this.options = { ...defaultOptions, ...options };

    // Assume we're using one layer with the given ID if no layer IDs are provided
    if (!this.options.layerIds || this.options.layerIds.length === 0) {
      this.options.layerIds = [id];
    }
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

  // WMS doesn't provide bounds in the URL, so we can't zoom the map
  // TODO: use getCapabilities to get the bounding box of the layer(s) and return that
  async getBounds() {
    return [
      [-180, -90],
      [180, 90],
    ] as [[number, number], [number, number]];
  }

  getSourceUrl() {
    return this.tilesUrl;
  }

  // WMS has no specific scheme identifier for MapLibre
  getScheme() {
    return undefined;
  }

  getTileSize() {
    return this.options.tileSize as number;
  }

  // WMS GetMap URL that will fetch tiles for this source
  private get tilesUrl() {
    const tilesUrl = new URL(this.url);

    // Construct the WMS URL with required parameters
    // See: https://doc.esri.com/en/arcgis-enterprise/latest/administer/communicating-with-a-wms-service-in-a-web-browser.html?pivots=os-windows
    tilesUrl.searchParams.set('service', 'WMS');
    tilesUrl.searchParams.set('request', 'GetMap');
    tilesUrl.searchParams.set('layers', this.options.layerIds.join(','));
    tilesUrl.searchParams.set('width', String(this.options.tileSize));
    tilesUrl.searchParams.set('height', String(this.options.tileSize));
    tilesUrl.searchParams.set('transparent', String(this.options.transparent));
    tilesUrl.searchParams.set('srs', this.options.srs as string);
    tilesUrl.searchParams.set('format', this.options.format as string);
    tilesUrl.searchParams.set('version', this.options.version as string);

    // This param can't be encoded because MapLibre needs to template it
    let tilesUrlString = tilesUrl.toString();
    tilesUrlString += `&bbox=${this.options.bbox}`;

    return tilesUrlString;
  }

  // WMS GetCapabilities URL, used to fetch metadata about the layers
  private get capabilitiesUrl() {
    const capabilitiesUrl = new URL(this.url);
    capabilitiesUrl.searchParams.set('service', 'WMS');
    capabilitiesUrl.searchParams.set('request', 'GetCapabilities');
    capabilitiesUrl.searchParams.set('version', this.options.version as string);
    return capabilitiesUrl.toString();
  }
}
