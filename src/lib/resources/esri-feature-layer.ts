import geojsonExtent from '@mapbox/geojson-extent';
import type { LngLatBoundsLike } from 'maplibre-gl';

import GeoJsonResource from './geojson';
import type { ResourceKind } from './resource';
import { esriExtentToBounds, esriQueryFeaturesToGeoJSON, esriZoomRange, fetchEsriJson, type EsriMetadata, type EsriQueryFeature } from '../esri';
import type { RequestTransform } from '../request';

// How many features to ask for at once when the service doesn't say. ArcGIS caps this itself, and
// reports its own cap, but a layer description can leave the number out.
const DEFAULT_PAGE_SIZE = 1000;

// Where to stop paging. A viewer can't usefully draw more than this at once, and a browser handed
// the whole of a national parcel layer would stall trying, so truncate and say so rather than hang.
const MAX_FEATURES = 10000;

// How long any one request has to answer. The read runs inside preview(), which <ogm-map> awaits
// before starting the deadline that catches a preview which never draws - so a service that accepts
// the connection and then says nothing would otherwise leave the spinner up for good.
const QUERY_TIMEOUT = 20_000;

// One page of a /query response, in either of the two formats a service may answer in
type EsriQueryResponse = {
  features?: (GeoJSON.Feature | EsriQueryFeature)[];
  objectIdFieldName?: string;
  exceededTransferLimit?: boolean;
  properties?: { exceededTransferLimit?: boolean };
};

// A single layer of a FeatureServer - or of a MapServer that allows querying - read as features
// rather than as a picture of them, so the preview can style, label and select them client-side.
export default class EsriFeatureLayerResource extends GeoJsonResource {
  readonly kind: ResourceKind = 'esri-feature-layer';

  // Layer endpoint the requests are built from, with any trailing slash removed
  private layerUrl: string;

  // Memoized layer description, fetched from the REST endpoint
  private metadata: EsriMetadata;

  // Memoized features, assembled from however many pages it took to read them
  private featureCollection: GeoJSON.FeatureCollection;

  // Whether the read gave up before the whole layer. Settles during getData, so it only means
  // anything once the features have been read.
  private stoppedShort = false;

  // A read already under way, so that several callers share one; see getData
  private pendingRead?: Promise<GeoJSON.FeatureCollection>;

  constructor(id: string, url: string, bounds?: LngLatBoundsLike, requestTransform?: RequestTransform) {
    super(id, url, bounds, requestTransform);
    this.layerUrl = url.replace(/\/+$/, '');
  }

  label() {
    return 'ArcGIS Feature Layer';
  }

  // Whether what was read is less than the whole layer, and how much of it there was. A preview
  // that quietly leaves features out should be able to tell the reader, not just the console.
  get truncated(): boolean {
    return this.stoppedShort;
  }

  get featuresRead(): number {
    return this.featureCollection?.features.length ?? 0;
  }

  // The zooms the service publishes this layer to be drawn between, if it publishes any. Most
  // don't, so most layers get an empty range and are drawn wherever they always were.
  async getZoomRange(): Promise<{ minzoom?: number; maxzoom?: number }> {
    return esriZoomRange(await this.getMetadata());
  }

  // Distinguish the layer name from plain GeoJSON, since a record can carry both
  async getVectorLayers() {
    return ['esri'];
  }

  // The features, read out of the service a page at a time. MapLibre can't fetch these itself the
  // way it can a GeoJSON file, because the response needs paging and may need converting, so this
  // is handed to the source as data rather than as a URL.
  async getData(): Promise<GeoJSON.FeatureCollection> {
    if (this.featureCollection) return this.featureCollection;

    // One read however many callers ask for it. A preview can be asked to draw again while the
    // first read is still going - a theme change, a camera crossing back into the layer's scale
    // window - and each of those would otherwise start a whole layer's worth of requests of its
    // own. Cleared either way, so a read that failed can be tried again rather than handing every
    // later caller the same rejection for the life of the resource.
    this.pendingRead ??= this.readFeatures().finally(() => (this.pendingRead = undefined));
    return await this.pendingRead;
  }

  private async readFeatures(): Promise<GeoJSON.FeatureCollection> {
    const features: GeoJSON.Feature[] = [];
    const pageSize = await this.getPageSize();
    const paged = await this.supportsPaging();
    let more = true;

    while (more && features.length < MAX_FEATURES) {
      const page = await this.getPage(features.length, pageSize);
      features.push(...page.features);

      // Stop on an empty page even if the service claims there's more, so one that ignores the
      // offset and keeps answering with the same page can't spin here forever
      more = paged && page.more && page.features.length > 0;
    }

    // Either we stopped while the service still had more to give, or the last page carried us past
    // the cap; a preview that quietly leaves features out should say so
    this.stoppedShort = more || features.length > MAX_FEATURES;
    if (this.stoppedShort) {
      console.warn(`${this.layerUrl} has more than ${MAX_FEATURES} features; only the first ${MAX_FEATURES} will be previewed.`);
    }

    this.featureCollection = { type: 'FeatureCollection', features: features.slice(0, MAX_FEATURES) };
    return this.featureCollection;
  }

  // Used to zoom the map to the data once loaded. The layer publishes its own extent, which is
  // cheaper and more accurate than measuring the features we happened to read.
  async getBounds() {
    if (this.bounds) return this.bounds;

    const extent = esriExtentToBounds((await this.getMetadata()).extent);
    if (extent) return extent;

    const bbox = geojsonExtent(await this.getData());
    if (!bbox) return undefined;
    return [
      [bbox[0], bbox[1]],
      [bbox[2], bbox[3]],
    ] as [[number, number], [number, number]];
  }

  // Fetch and memoize the layer description
  protected async getMetadata(): Promise<EsriMetadata> {
    if (!this.metadata) this.metadata = await fetchEsriJson(this.layerUrl, {}, this.requestTransform, AbortSignal.timeout(QUERY_TIMEOUT));
    return this.metadata;
  }

  // Read one page of features, converting them if the service can't answer in GeoJSON
  private async getPage(offset: number, pageSize: number) {
    const geojson = await this.supportsGeoJson();

    const response = await fetchEsriJson<EsriQueryResponse>(
      `${this.layerUrl}/query`,
      {
        where: '1=1',
        outFields: '*',
        returnGeometry: 'true',

        // MapLibre sources are always in degrees, so have the service reproject rather than doing it
        // ourselves - it knows the layer's own coordinate system, whatever it happens to be
        outSR: '4326',
        resultOffset: String(offset),
        resultRecordCount: String(pageSize),
        f: geojson ? 'geojson' : 'json',
      },
      this.requestTransform,
      AbortSignal.timeout(QUERY_TIMEOUT),
    );

    // The flag appears at the top level of an Esri JSON response and in either place in a GeoJSON
    // one, depending on the ArcGIS version
    const more = Boolean(response.exceededTransferLimit ?? response.properties?.exceededTransferLimit);

    if (geojson) return { features: (response.features ?? []) as GeoJSON.Feature[], more };
    return { features: esriQueryFeaturesToGeoJSON(response.features as EsriQueryFeature[], response.objectIdFieldName), more };
  }

  // Never ask for more per page than the service is willing to answer with, or it silently returns
  // its own cap and the paging arithmetic stops lining up
  private async getPageSize() {
    const { maxRecordCount } = await this.getMetadata();
    return maxRecordCount && maxRecordCount > 0 ? Math.min(maxRecordCount, DEFAULT_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
  }

  // Newer services answer in GeoJSON directly; older ones only speak Esri JSON, which we convert
  private async supportsGeoJson() {
    const { supportedQueryFormats } = await this.getMetadata();
    return /geojson/i.test(supportedQueryFormats ?? '');
  }

  // A service without paging ignores the offset, so there's no point asking for a second page
  private async supportsPaging() {
    const { advancedQueryCapabilities } = await this.getMetadata();
    return advancedQueryCapabilities?.supportsPagination !== false;
  }
}
