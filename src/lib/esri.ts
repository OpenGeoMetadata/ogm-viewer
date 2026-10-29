import { LngLatBounds, type LngLatBoundsLike } from 'maplibre-gl';

import { fetchOrThrow, HttpError } from './errors';
import { mercatorToLngLat } from './geometry';
import { resolveRequest, type RequestResourceType, type RequestTransform } from './request';

const WEB_MERCATOR_WKIDS = [3857, 102100, 102113, 900913];

const GEOGRAPHIC_WKIDS = [4326, 4269, 4267];

const MAX_LATITUDE = 90;

export type EsriSpatialReference = { wkid?: number; latestWkid?: number };

export type EsriExtent = {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
  spatialReference?: EsriSpatialReference;
};

export type EsriLevelOfDetail = { level: number; resolution: number; scale?: number };

export type EsriTileInfo = {
  rows?: number;
  cols?: number;
  origin?: { x: number; y: number };
  spatialReference?: EsriSpatialReference;
  lods?: EsriLevelOfDetail[];
};

export const ESRI_VECTOR_LAYER = 'esri';

export type EsriField = { name: string; type?: string; alias?: string };

export type EsriMetadata = {
  name?: string;
  capabilities?: string;
  extent?: EsriExtent;
  fullExtent?: EsriExtent;
  spatialReference?: EsriSpatialReference;
  singleFusedMapCache?: boolean;
  tileInfo?: EsriTileInfo;
  geometryType?: string;
  displayField?: string;
  fields?: EsriField[];

  minScale?: number;
  maxScale?: number;

  maxRecordCount?: number;
  tileMaxRecordCount?: number;
  standardMaxRecordCount?: number;
  maxRecordCountFactor?: number;

  supportsCoordinatesQuantization?: boolean;
  objectIdField?: string;
  objectIdFieldName?: string;
  supportedQueryFormats?: string;
  advancedQueryCapabilities?: {
    supportsPagination?: boolean;
    supportsQueryWithResultType?: boolean;
    supportsReturningQueryExtent?: boolean;
    supportsMaxRecordCountFactor?: boolean;
  };
};

export type EsriGeometry = {
  x?: number;
  y?: number;
  points?: GeoJSON.Position[];
  paths?: GeoJSON.Position[][];
  rings?: GeoJSON.Position[][];
  spatialReference?: EsriSpatialReference;
};

export type EsriIdentifyResult = {
  layerId?: number;
  layerName?: string;
  attributes?: Record<string, unknown>;
  geometry?: EsriGeometry | null;
};

export type EsriQueryFeature = { attributes?: Record<string, unknown>; geometry?: EsriGeometry | null };

export const isWebMercator = (spatialReference?: EsriSpatialReference) => {
  if (!spatialReference) return false;
  return WEB_MERCATOR_WKIDS.includes(spatialReference.latestWkid ?? spatialReference.wkid ?? 0);
};

export const isGeographic = (spatialReference?: EsriSpatialReference) => {
  if (!spatialReference) return false;
  return GEOGRAPHIC_WKIDS.includes(spatialReference.latestWkid ?? spatialReference.wkid ?? 0);
};

// Only WGS84 and Web Mercator extents can be converted without an additional projection library.
export const esriExtentToBounds = (extent?: EsriExtent): LngLatBoundsLike | undefined => {
  if (!extent) return undefined;

  const { xmin, ymin, xmax, ymax } = extent;
  if (![xmin, ymin, xmax, ymax].every(coordinate => Number.isFinite(coordinate))) return undefined;
  if (xmin >= xmax || ymin >= ymax) return undefined;

  let southWest: [number, number];
  let northEast: [number, number];

  if (isWebMercator(extent.spatialReference)) {
    southWest = mercatorToLngLat([xmin, ymin]);
    northEast = mercatorToLngLat([xmax, ymax]);
  } else if (isGeographic(extent.spatialReference)) {
    southWest = [xmin, ymin];
    northEast = [xmax, ymax];
  } else {
    return undefined;
  }

  const clampLatitude = ([lng, lat]: [number, number]): [number, number] => [lng, Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, lat))];

  return new LngLatBounds(clampLatitude(southWest), clampLatitude(northEast));
};

// ArcGIS uses 256px tiles at 96 dpi; MapLibre's zoom zero uses 512px tiles.
const SCALE_AT_ZOOM_0 = 591657527.591555 / 2;

const ZOOM_TOLERANCE = 0.001;

const MAX_ZOOM = 24;

export const scaleToZoom = (scale?: number): number | undefined => {
  if (!scale || !Number.isFinite(scale) || scale <= 0) return undefined;

  const zoom = Math.log2(SCALE_AT_ZOOM_0 / scale);
  const level = Math.round(zoom);
  return Math.max(0, Math.min(MAX_ZOOM, Math.abs(zoom - level) < ZOOM_TOLERANCE ? level : zoom));
};

// ArcGIS includes maxScale; MapLibre excludes maxzoom, so extend the upper bound slightly.
export const esriZoomRange = (metadata: EsriMetadata): { minzoom?: number; maxzoom?: number } => {
  const minzoom = scaleToZoom(metadata.minScale);
  const maxzoom = scaleToZoom(metadata.maxScale);

  return {
    ...(minzoom !== undefined && { minzoom }),
    ...(maxzoom !== undefined && { maxzoom: Math.min(MAX_ZOOM, maxzoom + 1) }),
  };
};

export const esriObjectIdField = (metadata: EsriMetadata): string =>
  metadata.objectIdField ?? metadata.objectIdFieldName ?? metadata.fields?.find(field => field.type === 'esriFieldTypeOID')?.name ?? 'OBJECTID';

export const esriExtentToSourceBounds = (extent?: EsriExtent): [number, number, number, number] | undefined => {
  const bounds = esriExtentToBounds(extent);
  if (!bounds) return undefined;
  const [[west, south], [east, north]] = (bounds as LngLatBounds).toArray();
  return [west, south, east, north];
};

const signedArea = (ring: GeoJSON.Position[]) => {
  let total = 0;
  for (let i = 0, previous = ring.length - 1; i < ring.length; previous = i++) {
    total += ring[previous][0] * ring[i][1] - ring[i][0] * ring[previous][1];
  }
  return total;
};

// Esri ring winding distinguishes outlines from holes; GeoJSON groups each hole with its outline.
const ringsToGeometry = (rings: GeoJSON.Position[][]): GeoJSON.Geometry | null => {
  const polygons: GeoJSON.Position[][][] = [];

  rings.forEach(ring => {
    if (polygons.length === 0 || signedArea(ring) < 0) polygons.push([ring]);
    else polygons[polygons.length - 1].push(ring);
  });

  if (polygons.length === 0) return null;
  if (polygons.length === 1) return { type: 'Polygon', coordinates: polygons[0] };
  return { type: 'MultiPolygon', coordinates: polygons };
};

export const esriGeometryToGeoJSON = (geometry?: EsriGeometry | null): GeoJSON.Geometry | null => {
  if (!geometry) return null;
  if (geometry.rings) return ringsToGeometry(geometry.rings);
  if (geometry.paths) {
    if (geometry.paths.length === 1) return { type: 'LineString', coordinates: geometry.paths[0] };
    return { type: 'MultiLineString', coordinates: geometry.paths };
  }
  if (geometry.points) return { type: 'MultiPoint', coordinates: geometry.points };
  if (Number.isFinite(geometry.x) && Number.isFinite(geometry.y)) {
    return { type: 'Point', coordinates: [geometry.x as number, geometry.y as number] };
  }
  return null;
};

export const esriIdentifyResultsToFeatures = (results: EsriIdentifyResult[] = []): GeoJSON.Feature[] =>
  results.map((result, index) => ({
    type: 'Feature',
    id: index,
    geometry: esriGeometryToGeoJSON(result.geometry) as GeoJSON.Geometry,
    properties: (result.attributes ?? {}) as GeoJSON.GeoJsonProperties,
  }));

export const esriQueryFeaturesToGeoJSON = (features: EsriQueryFeature[] = [], objectIdFieldName = 'OBJECTID'): GeoJSON.Feature[] =>
  features.map((feature, index) => ({
    type: 'Feature',
    id: (feature.attributes?.[objectIdFieldName] as string | number) ?? index,
    geometry: esriGeometryToGeoJSON(feature.geometry) as GeoJSON.Geometry,
    properties: (feature.attributes ?? {}) as GeoJSON.GeoJsonProperties,
  }));

// ArcGIS can report errors in a successful HTTP response, so inspect the body too.
export const throwOnEsriError = <T>(body: T, url: string): T => {
  const error = (body as { error?: { code?: number; message?: string; details?: string[] } })?.error;
  if (!error) return body;

  const message = [error.message, ...(error.details ?? [])].filter(Boolean).join(' ');
  throw new HttpError(url, error.code ?? 500, message || 'ArcGIS request failed');
};

export const fetchEsriJson = async <T = EsriMetadata>(
  url: string,
  params: Record<string, string> = {},
  requestTransform?: RequestTransform,
  signal?: AbortSignal,

  kind: RequestResourceType = 'metadata',
): Promise<T> => {
  const requestUrl = new URL(url);
  Object.entries({ f: 'json', ...params }).forEach(([key, value]) => requestUrl.searchParams.set(key, value));

  const { url: resolvedUrl, init } = resolveRequest(requestUrl.toString(), kind, requestTransform);
  const response = await fetchOrThrow(resolvedUrl, { ...init, ...(signal && { signal }) });
  return throwOnEsriError((await response.json()) as T, resolvedUrl);
};

export const hasCapability = (metadata: EsriMetadata, capability: string) =>
  (metadata.capabilities ?? '')
    .split(',')
    .map(entry => entry.trim())
    .includes(capability);

export const splitEsriLayerUrl = (url: string): { serviceUrl: string; layerId?: string } => {
  const trimmed = url.replace(/\/+$/, '');
  const match = trimmed.match(/^(?<serviceUrl>.+)\/(?<layerId>\d+)$/);
  if (!match?.groups) return { serviceUrl: trimmed };
  return { serviceUrl: match.groups.serviceUrl, layerId: match.groups.layerId };
};
