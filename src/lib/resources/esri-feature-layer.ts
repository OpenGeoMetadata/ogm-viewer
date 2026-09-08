import geojsonExtent from '@mapbox/geojson-extent';
import type { LngLatBoundsLike, MapGeoJSONFeature } from 'maplibre-gl';

import GeoJsonResource from './geojson';
import type { ResourceKind } from './resource';
import { encodeFeatureTile, featureTileUrl, TILE_BUFFER_RATIO, TILE_EXTENT } from '../esri-features';
import {
  ESRI_VECTOR_LAYER,
  esriExtentToBounds,
  esriExtentToSourceBounds,
  esriObjectIdField,
  esriQueryFeaturesToGeoJSON,
  esriZoomRange,
  fetchEsriJson,
  scaleToZoom,
  type EsriExtent,
  type EsriMetadata,
  type EsriQueryFeature,
} from '../esri';
import { readBounds, tileBbox3857, tileLngLatSpan, tilesCovering } from '../geometry';
import type { RequestTransform } from '../request';

// How many features to ask for at once when the service doesn't say. ArcGIS caps this itself, and
// reports its own cap, but a layer description can leave the number out.
const DEFAULT_PAGE_SIZE = 1000;

// Where to stop paging. A viewer can't usefully draw more than this at once, and a browser handed
// the whole of a national parcel layer would stall trying, so truncate and say so rather than hang.
const MAX_FEATURES = 10000;

// What ArcGIS calls every field of a layer at once
const ALL_FIELDS = '*';

// The property names the style layers read - see VectorPreviewer's label expression and its
// dataColorExpression. Asked for only when the layer really has them, so a slim read still draws
// exactly what a whole one would.
const STYLE_FIELDS = ['label', 'id', 'available'];

// Up to how many features a layer can hold and still be read with every field it has. Above this
// the attributes are the payload - measured at 1,749 bytes a feature against 138 for a geometry and
// an ObjectID - and are better fetched for the one feature a reader actually clicks.
const ALL_FIELDS_MAX_FEATURES = 2000;

// Above this many features a layer is drawn from tiles of its own rather than read whole. The same
// number as the field threshold above, for the same reason: one page of features with everything
// the service knows about them is as much as a browser should be handed in one go.
const TILED_MIN_FEATURES = ALL_FIELDS_MAX_FEATURES;

// How many features a tile should hold before the zoom it was cut at is too coarse to draw at all
const TILE_FEATURE_BUDGET = 2000;

// The deepest zoom tiles are cut for. Past this MapLibre scales up the deepest tile it has, and
// keeps recomputing symbol layout and circle radii per zoom as it does, so the drawing stays right
// while the requests stop. A tile's 4,096 units at this zoom are about 15cm of ground each.
const TILE_MAXZOOM = 16;

// How many features one click can ask the service about. A click lands on a handful even where the
// data is dense, and the ids travel in the query string.
const MAX_INSPECTED = 25;

// How long any one request has to answer. The read runs inside preview(), which <ogm-map> awaits
// before starting the deadline that catches a preview which never draws - so a service that accepts
// the connection and then says nothing would otherwise leave the spinner up for good.
const QUERY_TIMEOUT = 20_000;

// What a MapLibre vector source needs to draw this layer from tiles of our own
export type EsriVectorSourceSpec = {
  tiles: string[];
  minzoom: number;
  maxzoom: number;
  bounds?: [number, number, number, number];
};

// How one page of a read is asked for; see getPaging
type Paging = { pageSize: number; resultType?: string };

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
  // anything once the features have been read. The whole-layer read only - a tiled layer never
  // makes one; see cappedZoom.
  private stoppedShort = false;

  // The deepest zoom at which the service has cut a tile short, if it has. A tile comes back at the
  // service's own per-request limit when its box holds more features than one answer will carry,
  // and what was left out is invisible - a thinner scatter of points looks like a thinner scatter
  // of points. Kept as a zoom rather than a flag because zooming in is the fix: tiles cover less
  // ground the further in you go, so past this they fit, and the notice has to stop then.
  private cappedZoom?: number;

  // A read already under way, so that several callers share one; see getData
  private pendingRead?: Promise<GeoJSON.FeatureCollection>;

  // Memoized answer to how much of this layer there is and where; see getQuerySummary
  private summary?: Promise<{ count?: number; extent?: EsriExtent }>;

  // Whether any tile has come back at all, and whether we have said that one didn't; see fetchTile
  private tileDrawn = false;
  private tileFailureReported = false;

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

  // The deepest zoom whose tiles the service would not answer in full, so a caller can stop saying
  // so once the reader is past it
  get cappedAtZoom(): number | undefined {
    return this.cappedZoom;
  }

  // The zooms the service publishes this layer to be drawn between, if it publishes any. Most
  // don't, so most layers get an empty range and are drawn wherever they always were.
  async getZoomRange(): Promise<{ minzoom?: number; maxzoom?: number }> {
    return esriZoomRange(await this.getMetadata());
  }

  // Distinguish the layer name from plain GeoJSON, since a record can carry both
  async getVectorLayers() {
    return [ESRI_VECTOR_LAYER];
  }

  // How many features the layer holds, if the service will say. Free once the size probe has run,
  // which it has by the time anything is drawn.
  async getFeatureCount(): Promise<number | undefined> {
    return (await this.getQuerySummary()).count;
  }

  // Whether this layer is too much to read whole, and should be drawn from tiles cut on demand
  // instead. A layer that won't say how big it is is tiled: an empty tile and a warning is a better
  // failure than a stalled browser, and the layer whose size is a surprise is the one to be careful
  // with. See EsriTiledFeatureLayerPreviewer.
  async tilesFeatures(): Promise<boolean> {
    const { count } = await this.getQuerySummary();
    return count === undefined || count > TILED_MIN_FEATURES;
  }

  // What a MapLibre vector source needs to ask us for this layer's tiles. The token is how the
  // protocol handler finds its way back to this resource; see esri-features.
  async getVectorSourceSpec(token: string): Promise<EsriVectorSourceSpec> {
    const metadata = await this.getMetadata();

    // Tiles are only asked for where the layer is both published to be drawn and coarse enough to
    // draw: whichever of the two floors is higher wins
    const published = scaleToZoom(metadata.minScale) ?? 0;
    const drawable = await this.getDensityFloor();

    // The query's own extent for preference: a layer publishes its own in whatever coordinate
    // system it is stored in, and this one always comes back in degrees. Either way it stops
    // MapLibre asking for a tile of somewhere the layer isn't, which is most tiles.
    const bounds = esriExtentToSourceBounds((await this.getQuerySummary()).extent) ?? esriExtentToSourceBounds(metadata.extent);

    return {
      tiles: [featureTileUrl(token)],
      minzoom: Math.min(TILE_MAXZOOM, Math.max(published, drawable)),
      maxzoom: Math.min(TILE_MAXZOOM, scaleToZoom(metadata.maxScale) ?? TILE_MAXZOOM),
      ...(bounds && { bounds }),
    };
  }

  // One tile's features, encoded as the vector tile MapLibre asked for, or nothing for a tile of
  // ocean. Answers for its own failures rather than throwing them at the map: a tiled layer makes
  // tens of these, and one that went wrong after something has already drawn is worth a line in the
  // console rather than an alert over a preview a reader is looking at.
  async fetchTile(z: number, x: number, y: number, signal?: AbortSignal): Promise<ArrayBuffer | undefined> {
    try {
      const features = await this.queryTile(z, x, y, signal);
      this.tileDrawn = true;
      return encodeFeatureTile(features, z, x, y, esriObjectIdField(await this.getMetadata()));
    } catch (error) {
      // Whoever asked for this tile has stopped waiting for it; that is not a failure of anyone's
      if ((error as Error)?.name === 'AbortError') throw error;

      // Nothing has drawn yet, so this is the failure that explains an empty map
      if (!this.tileDrawn) throw error;

      if (!this.tileFailureReported) {
        this.tileFailureReported = true;
        console.warn(`Could not read a tile of ${this.layerUrl}:`, error);
      }
      return undefined;
    }
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
    const paging = await this.getPaging();
    const paged = await this.supportsPaging();
    let more = true;

    while (more && features.length < MAX_FEATURES) {
      const page = await this.getPage(features.length, paging);
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

    // The one the query reports, which is in degrees whatever the layer is stored in
    const measured = esriExtentToBounds((await this.getQuerySummary()).extent);
    if (measured) return measured;

    // Measuring the features is the last resort, and only for a layer small enough to read: a
    // tiled one has no whole collection to measure, and asking for one to answer a question about
    // where to point the camera is the read this all exists to avoid.
    if (await this.tilesFeatures()) return undefined;

    const bbox = geojsonExtent(await this.getData());
    if (!bbox) return undefined;
    return [
      [bbox[0], bbox[1]],
      [bbox[2], bbox[3]],
    ] as [[number, number], [number, number]];
  }

  // How much of this layer there is, and where it is, in one request. Both answers come out of
  // statistics the service already keeps - it lists 'count' and 'extent' among its infoInEstimates -
  // so this stays cheap on a layer of a million features. The same question asked about a viewport
  // is not cheap at all: the service has to go and answer that one, and on a dense layer it takes
  // the better part of a minute.
  //
  // The extent earns its place as much as the count does. A layer publishes its own in whatever
  // coordinate system it is stored in, which esriExtentToBounds can only convert for two of them,
  // and asking the query for its extent in degrees gets one we can always use.
  protected async getQuerySummary(): Promise<{ count?: number; extent?: EsriExtent }> {
    this.summary ??= fetchEsriJson<{ count?: number; extent?: EsriExtent }>(
      `${this.layerUrl}/query`,
      { where: '1=1', returnCountOnly: 'true', returnExtentOnly: 'true', outSR: '4326' },
      this.requestTransform,
      AbortSignal.timeout(QUERY_TIMEOUT),
    ).catch(error => {
      // Nothing decided from this is worth failing a preview over. Without it the read asks for
      // every field, which is what it did before this existed.
      console.warn(`Could not measure ${this.layerUrl}:`, error);
      return {};
    });

    return await this.summary;
  }

  // Which fields to read the features with. A layer small enough to hold in a browser is read whole,
  // so a click has everything already; a larger one is read with only what the map draws with, and
  // a click is when the rest is worth a request. See getAttributes.
  //
  // A layer that won't say how big it is gets the slim read, on the grounds that the one whose size
  // is a surprise is the one that shouldn't be read in full.
  protected async getOutFields(): Promise<string> {
    const { count } = await this.getQuerySummary();
    if (count !== undefined && count <= ALL_FIELDS_MAX_FEATURES) return ALL_FIELDS;

    const metadata = await this.getMetadata();
    const published = new Set(metadata.fields?.map(field => field.name) ?? []);

    // Only the ones the layer really has: a field name we invented is one the service rejects the
    // whole query for, and a style expression reading a property that isn't there behaves exactly
    // as it does today on a layer that never had it.
    return [esriObjectIdField(metadata), ...STYLE_FIELDS.filter(name => published.has(name))].join(',');
  }

  // Whether the features already carry everything the service knows about them, so that a click has
  // nothing left to ask for
  async readsAllFields(): Promise<boolean> {
    return (await this.getOutFields()) === ALL_FIELDS;
  }

  // Everything the service knows about the given features, for the popup a click opens. Asked for
  // by id rather than by geometry, so the answer is exactly the features that were clicked.
  async getAttributes(objectIds: (string | number)[], signal?: AbortSignal): Promise<Map<string | number, GeoJSON.GeoJsonProperties>> {
    const attributes = new Map<string | number, GeoJSON.GeoJsonProperties>();
    if (objectIds.length === 0) return attributes;

    const response = await fetchEsriJson<{ features?: EsriQueryFeature[]; objectIdFieldName?: string }>(
      `${this.layerUrl}/query`,
      {
        objectIds: objectIds.slice(0, MAX_INSPECTED).join(','),
        outFields: ALL_FIELDS,
        returnGeometry: 'false',
      },
      this.requestTransform,
      signal ?? AbortSignal.timeout(QUERY_TIMEOUT),
    );

    const idField = response.objectIdFieldName ?? esriObjectIdField(await this.getMetadata());
    (response.features ?? []).forEach(feature => {
      const id = feature.attributes?.[idField] as string | number | undefined;
      if (id !== undefined) attributes.set(id, feature.attributes as GeoJSON.GeoJsonProperties);
    });

    return attributes;
  }

  // Fetch the attributes the features were read without. A layer small enough to hold whole was
  // read with all of them and needs no request; a larger one carries only what the map draws with,
  // which is a twelfth of the bytes and everything a reader wants to see once they click.
  //
  // A failure leaves the features as they came, so the popup opens on the ObjectID rather than not
  // opening: <ogm-map> already treats a failed inspection as one unanswered click.
  async expandFeatures(features: MapGeoJSONFeature[]): Promise<MapGeoJSONFeature[]> {
    if (features.length === 0 || (await this.readsAllFields())) return features;

    const ids = features.map(feature => feature.id).filter((id): id is string | number => id !== undefined);
    const attributes = await this.getAttributes(ids).catch(error => {
      console.warn(`Could not read the attributes of a feature of ${this.layerUrl}:`, error);
      return new Map<string | number, GeoJSON.GeoJsonProperties>();
    });

    return features.map(feature => {
      const found = feature.id === undefined ? undefined : attributes.get(feature.id);
      if (!found) return feature;

      // A copy that keeps its prototype, and written to rather than the original. A rendered
      // feature holds its coordinates in _geometry behind a getter, so a plain spread of one comes
      // out with no geometry at all; and the properties object it carries is the one MapLibre's own
      // tile cache is holding, so assigning into that would be assigning into the cache.
      const expanded = Object.assign(Object.create(Object.getPrototypeOf(feature)) as MapGeoJSONFeature, feature);
      expanded.properties = found;
      return expanded;
    });
  }

  // Fetch and memoize the layer description
  protected async getMetadata(): Promise<EsriMetadata> {
    if (!this.metadata) this.metadata = await fetchEsriJson(this.layerUrl, {}, this.requestTransform, AbortSignal.timeout(QUERY_TIMEOUT));
    return this.metadata;
  }

  // Read one page of features, converting them if the service can't answer in GeoJSON
  private async getPage(offset: number, { pageSize, resultType }: Paging) {
    const geojson = await this.supportsGeoJson();

    const response = await fetchEsriJson<EsriQueryResponse>(
      `${this.layerUrl}/query`,
      {
        where: '1=1',
        outFields: await this.getOutFields(),
        returnGeometry: 'true',

        // MapLibre sources are always in degrees, so have the service reproject rather than doing it
        // ourselves - it knows the layer's own coordinate system, whatever it happens to be
        outSR: '4326',
        resultOffset: String(offset),
        resultRecordCount: String(pageSize),
        ...(resultType && { resultType }),
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

  // How many features to ask for at once, and what to ask for them as.
  //
  // A plain query is held to maxRecordCount, but a service that understands resultType will answer
  // a 'standard' one with standardMaxRecordCount instead - 16,000 rather than 2,000 on the layer
  // this was written for, which is the difference between one round trip and eight. Never more than
  // the whole read is going to keep either way: a page bigger than that is bytes spent on features
  // that get sliced off again. And never more than the cap in play, or the service quietly answers
  // with its own and the paging arithmetic stops lining up.
  private async getPaging(): Promise<Paging> {
    const { maxRecordCount, standardMaxRecordCount, advancedQueryCapabilities } = await this.getMetadata();
    const standard = advancedQueryCapabilities?.supportsQueryWithResultType !== false && (standardMaxRecordCount ?? 0) > 0;
    const cap = (standard ? standardMaxRecordCount : maxRecordCount) || DEFAULT_PAGE_SIZE;

    return { pageSize: Math.min(MAX_FEATURES, cap), ...(standard && { resultType: 'standard' }) };
  }

  // One tile's worth of features, in whichever format the service can answer in
  private async queryTile(z: number, x: number, y: number, signal?: AbortSignal): Promise<GeoJSON.Feature[]> {
    const metadata = await this.getMetadata();
    const geojson = await this.supportsGeoJson();
    const cap = metadata.tileMaxRecordCount || metadata.maxRecordCount || DEFAULT_PAGE_SIZE;

    // Generalizing costs nothing to ask for and saves a great deal on a polygon layer, where an
    // ungeneralized county boundary is most of the tile. Read in outSR's units, so degrees here,
    // and asked for as one of the tile's own coordinate units - the finest detail it can draw.
    // Left off for points, which have no detail to throw away.
    const offset: Record<string, string> = metadata.geometryType === 'esriGeometryPoint' ? {} : { maxAllowableOffset: String(tileLngLatSpan(z) / TILE_EXTENT) };

    const response = await fetchEsriJson<EsriQueryResponse>(
      `${this.layerUrl}/query`,
      {
        where: '1=1',

        // A comma envelope in the grid MapLibre draws in, so nothing has to be reprojected on the
        // way out and the URL stays short enough for a browser to cache
        geometry: tileBbox3857(z, x, y, TILE_BUFFER_RATIO).join(','),
        geometryType: 'esriGeometryEnvelope',
        inSR: '3857',

        // Intersects rather than the looser envelope test: it still includes a polygon that
        // swallows the whole tile, and it returns nothing the tiler would only clip away again
        spatialRel: 'esriSpatialRelIntersects',
        outSR: '4326',
        outFields: await this.getOutFields(),
        returnGeometry: 'true',
        resultRecordCount: String(cap),
        ...(await this.tileResultType()),
        ...offset,
        f: geojson ? 'geojson' : 'json',
      },
      this.requestTransform,
      signal ?? AbortSignal.timeout(QUERY_TIMEOUT),
      'tile',
    );

    // A tile the service had to cut short has features in it that never reached the map. Recorded
    // against the zoom it happened at, not as a flag: one dense tile at the zoom a layer starts
    // drawing at is normal - one of nine over downtown Columbus - and it stops being true as soon
    // as the reader goes further in, so a flag would leave the notice on for good.
    if (response.exceededTransferLimit ?? response.properties?.exceededTransferLimit) {
      this.cappedZoom = Math.max(this.cappedZoom ?? z, z);
    }

    if (geojson) return (response.features ?? []) as GeoJSON.Feature[];
    return esriQueryFeaturesToGeoJSON(response.features as EsriQueryFeature[], response.objectIdFieldName ?? esriObjectIdField(metadata));
  }

  // Asking for a tile's worth raises what one answer may hold - 8,000 rather than 2,000 on the
  // layer this was written for. A service that hasn't said it understands the parameter is sent the
  // factor instead, which does the same job the older way.
  private async tileResultType(): Promise<Record<string, string>> {
    const { advancedQueryCapabilities, maxRecordCountFactor } = await this.getMetadata();
    if (advancedQueryCapabilities?.supportsQueryWithResultType !== false) return { resultType: 'tile' };
    if (advancedQueryCapabilities?.supportsMaxRecordCountFactor && maxRecordCountFactor) return { maxRecordCountFactor: String(maxRecordCountFactor) };
    return {};
  }

  // The coarsest zoom whose tiles hold few enough features to be worth drawing, for a layer whose
  // service publishes no scale of its own - which is most of them.
  //
  // Worked out from the layer's own count and extent, so it is a mean, and a mean understates how
  // crowded a city is: a tile over downtown Columbus holds two hundred times the average of the
  // address layer it belongs to. This is a floor under the absurd - a whole state of points asked
  // for in one tile - and not a promise that a tile fits. What a tile came back short is what says
  // that, per view, which is the only place it can honestly be said.
  private async getDensityFloor(): Promise<number> {
    const { count, extent } = await this.getQuerySummary();
    const bounds = esriExtentToBounds(extent) ?? esriExtentToBounds((await this.getMetadata()).extent);
    if (!count || !bounds) return 0;

    const readable = readBounds(bounds);
    if (!readable) return 0;

    for (let zoom = 0; zoom < TILE_MAXZOOM; zoom += 1) {
      if (count / tilesCovering(readable, zoom) <= TILE_FEATURE_BUDGET) return zoom;
    }
    return TILE_MAXZOOM;
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
