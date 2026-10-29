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

const DEFAULT_PAGE_SIZE = 1000;

const MAX_FEATURES = 10000;

const ALL_FIELDS = '*';

const STYLE_FIELDS = ['label', 'id', 'available'];

// Read every field only for small layers; attributes dominate the payload for large services.
const ALL_FIELDS_MAX_FEATURES = 2000;

const TILED_MIN_FEATURES = ALL_FIELDS_MAX_FEATURES;

const TILE_FEATURE_BUDGET = 2000;

// Above this zoom MapLibre overzooms the deepest tile instead of querying ever-smaller areas.
const TILE_MAXZOOM = 16;

const MAX_INSPECTED = 25;

const QUERY_TIMEOUT = 20_000;

export type EsriVectorSourceSpec = {
  tiles: string[];
  minzoom: number;
  maxzoom: number;
  bounds?: [number, number, number, number];
};

type Paging = { pageSize: number; resultType?: string };

type EsriQueryResponse = {
  features?: (GeoJSON.Feature | EsriQueryFeature)[];
  objectIdFieldName?: string;
  exceededTransferLimit?: boolean;
  properties?: { exceededTransferLimit?: boolean };
};

export default class EsriFeatureLayerResource extends GeoJsonResource {
  readonly kind: ResourceKind = 'esri-feature-layer';

  private layerUrl: string;

  private metadata: EsriMetadata;

  private featureCollection: GeoJSON.FeatureCollection;

  private stoppedShort = false;

  private cappedZoom?: number;
  private cappedLimit = 0;

  private pendingRead?: Promise<GeoJSON.FeatureCollection>;

  private summary?: Promise<{ count?: number; extent?: EsriExtent }>;

  private tileDrawn = false;
  private tileFailureReported = false;

  constructor(id: string, url: string, bounds?: LngLatBoundsLike, requestTransform?: RequestTransform) {
    super(id, url, bounds, requestTransform);
    this.layerUrl = url.replace(/\/+$/, '');
  }

  label() {
    return 'ArcGIS Feature Layer';
  }

  get truncated(): boolean {
    return this.stoppedShort;
  }

  get featuresRead(): number {
    return this.featureCollection?.features.length ?? 0;
  }

  get cappedTiles(): { zoom: number; limit: number } | undefined {
    return this.cappedZoom === undefined ? undefined : { zoom: this.cappedZoom, limit: this.cappedLimit };
  }

  async getZoomRange(): Promise<{ minzoom?: number; maxzoom?: number }> {
    return esriZoomRange(await this.getMetadata());
  }

  async getVectorLayers() {
    return [ESRI_VECTOR_LAYER];
  }

  async getFeatureCount(): Promise<number | undefined> {
    return (await this.getQuerySummary()).count;
  }

  // Tile layers of unknown size to avoid an unbounded download.
  async tilesFeatures(): Promise<boolean> {
    const { count } = await this.getQuerySummary();
    return count === undefined || count > TILED_MIN_FEATURES;
  }

  async getVectorSourceSpec(token: string): Promise<EsriVectorSourceSpec> {
    const metadata = await this.getMetadata();

    const published = scaleToZoom(metadata.minScale) ?? 0;
    const drawable = await this.getDensityFloor();

    const bounds = esriExtentToSourceBounds((await this.getQuerySummary()).extent) ?? esriExtentToSourceBounds(metadata.extent);

    return {
      tiles: [featureTileUrl(token)],
      minzoom: Math.min(TILE_MAXZOOM, Math.max(published, drawable)),
      maxzoom: Math.min(TILE_MAXZOOM, scaleToZoom(metadata.maxScale) ?? TILE_MAXZOOM),
      ...(bounds && { bounds }),
    };
  }

  async fetchTile(z: number, x: number, y: number, signal?: AbortSignal): Promise<ArrayBuffer | undefined> {
    try {
      const features = await this.queryTile(z, x, y, signal);
      this.tileDrawn = true;
      return encodeFeatureTile(features, z, x, y, esriObjectIdField(await this.getMetadata()));
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') throw error;

      if (!this.tileDrawn) throw error;

      if (!this.tileFailureReported) {
        this.tileFailureReported = true;
        console.warn(`Could not read a tile of ${this.layerUrl}:`, error);
      }
      return undefined;
    }
  }

  async getData(): Promise<GeoJSON.FeatureCollection> {
    if (this.featureCollection) return this.featureCollection;

    // Share an in-flight read across redraws so concurrent calls do not page through the service twice.
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

      more = paged && page.more && page.features.length > 0;
    }

    this.stoppedShort = more || features.length > MAX_FEATURES;
    if (this.stoppedShort) {
      console.warn(`${this.layerUrl} has more than ${MAX_FEATURES} features; only the first ${MAX_FEATURES} will be previewed.`);
    }

    this.featureCollection = { type: 'FeatureCollection', features: features.slice(0, MAX_FEATURES) };
    return this.featureCollection;
  }

  async getReportedBounds() {
    const extent = esriExtentToBounds((await this.getMetadata()).extent);
    if (extent) return extent;

    const measured = esriExtentToBounds((await this.getQuerySummary()).extent);
    if (measured) return measured;

    if (await this.tilesFeatures()) return undefined;

    const bbox = geojsonExtent(await this.getData());
    if (!bbox) return undefined;
    return [
      [bbox[0], bbox[1]],
      [bbox[2], bbox[3]],
    ] as [[number, number], [number, number]];
  }

  protected async getQuerySummary(): Promise<{ count?: number; extent?: EsriExtent }> {
    this.summary ??= fetchEsriJson<{ count?: number; extent?: EsriExtent }>(
      `${this.layerUrl}/query`,
      { where: '1=1', returnCountOnly: 'true', returnExtentOnly: 'true', outSR: '4326' },
      this.requestTransform,
      AbortSignal.timeout(QUERY_TIMEOUT),
    ).catch(error => {
      console.warn(`Could not measure ${this.layerUrl}:`, error);
      return {};
    });

    return await this.summary;
  }

  protected async getOutFields(): Promise<string> {
    const { count } = await this.getQuerySummary();
    if (count !== undefined && count <= ALL_FIELDS_MAX_FEATURES) return ALL_FIELDS;

    const metadata = await this.getMetadata();
    const published = new Set(metadata.fields?.map(field => field.name) ?? []);

    // Only request published fields; an invented style field makes ArcGIS reject the entire query.
    return [esriObjectIdField(metadata), ...STYLE_FIELDS.filter(name => published.has(name))].join(',');
  }

  async readsAllFields(): Promise<boolean> {
    return (await this.getOutFields()) === ALL_FIELDS;
  }

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

      // Preserve the prototype so MapLibre's geometry getter continues to work on the expanded feature.
      const expanded = Object.assign(Object.create(Object.getPrototypeOf(feature)) as MapGeoJSONFeature, feature);
      expanded.properties = found;
      return expanded;
    });
  }

  protected async getMetadata(): Promise<EsriMetadata> {
    if (!this.metadata) this.metadata = await fetchEsriJson(this.layerUrl, {}, this.requestTransform, AbortSignal.timeout(QUERY_TIMEOUT));
    return this.metadata;
  }

  private async getPage(offset: number, { pageSize, resultType }: Paging) {
    const geojson = await this.supportsGeoJson();

    const response = await fetchEsriJson<EsriQueryResponse>(
      `${this.layerUrl}/query`,
      {
        where: '1=1',
        outFields: await this.getOutFields(),
        returnGeometry: 'true',

        outSR: '4326',
        resultOffset: String(offset),
        resultRecordCount: String(pageSize),
        ...(resultType && { resultType }),
        f: geojson ? 'geojson' : 'json',
      },
      this.requestTransform,
      AbortSignal.timeout(QUERY_TIMEOUT),
    );

    const more = Boolean(response.exceededTransferLimit ?? response.properties?.exceededTransferLimit);

    if (geojson) return { features: (response.features ?? []) as GeoJSON.Feature[], more };
    return { features: esriQueryFeaturesToGeoJSON(response.features as EsriQueryFeature[], response.objectIdFieldName), more };
  }

  private async getPaging(): Promise<Paging> {
    const { maxRecordCount, standardMaxRecordCount, advancedQueryCapabilities } = await this.getMetadata();
    const standard = advancedQueryCapabilities?.supportsQueryWithResultType !== false && (standardMaxRecordCount ?? 0) > 0;
    const cap = (standard ? standardMaxRecordCount : maxRecordCount) || DEFAULT_PAGE_SIZE;

    return { pageSize: Math.min(MAX_FEATURES, cap), ...(standard && { resultType: 'standard' }) };
  }

  private async queryTile(z: number, x: number, y: number, signal?: AbortSignal): Promise<GeoJSON.Feature[]> {
    const metadata = await this.getMetadata();
    const geojson = await this.supportsGeoJson();
    const cap = metadata.tileMaxRecordCount || metadata.maxRecordCount || DEFAULT_PAGE_SIZE;

    const offset: Record<string, string> = metadata.geometryType === 'esriGeometryPoint' ? {} : { maxAllowableOffset: String(tileLngLatSpan(z) / TILE_EXTENT) };

    const response = await fetchEsriJson<EsriQueryResponse>(
      `${this.layerUrl}/query`,
      {
        where: '1=1',

        geometry: tileBbox3857(z, x, y, TILE_BUFFER_RATIO).join(','),
        geometryType: 'esriGeometryEnvelope',
        inSR: '3857',

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

    const features = geojson
      ? ((response.features ?? []) as GeoJSON.Feature[])
      : esriQueryFeaturesToGeoJSON(response.features as EsriQueryFeature[], response.objectIdFieldName ?? esriObjectIdField(metadata));

    // Track truncation by zoom so the warning clears when the user zooms into smaller, complete tiles.
    if ((response.exceededTransferLimit ?? response.properties?.exceededTransferLimit) && z >= (this.cappedZoom ?? z)) {
      this.cappedZoom = z;
      this.cappedLimit = features.length;
    }

    return features;
  }

  private async tileResultType(): Promise<Record<string, string>> {
    const { advancedQueryCapabilities, maxRecordCountFactor } = await this.getMetadata();
    if (advancedQueryCapabilities?.supportsQueryWithResultType !== false) return { resultType: 'tile' };
    if (advancedQueryCapabilities?.supportsMaxRecordCountFactor && maxRecordCountFactor) return { maxRecordCountFactor: String(maxRecordCountFactor) };
    return {};
  }

  // Use mean feature density as a zoom floor; individual dense tiles can still exceed the service limit.
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

  private async supportsGeoJson() {
    const { supportedQueryFormats } = await this.getMetadata();
    return /geojson/i.test(supportedQueryFormats ?? '');
  }

  private async supportsPaging() {
    const { advancedQueryCapabilities } = await this.getMetadata();
    return advancedQueryCapabilities?.supportsPagination !== false;
  }
}
