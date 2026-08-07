import { LngLatBounds, type LngLatBoundsLike } from 'maplibre-gl';

import { fetchOrThrow, HttpError } from './errors';
import { mercatorToLngLat } from './geometry';
import { resolveRequest, type RequestTransform } from './request';

// ArcGIS identifies Web Mercator by its own well-known ID as often as by the EPSG code, and older
// services still use the pre-EPSG variants; all four describe the grid MapLibre draws in.
const WEB_MERCATOR_WKIDS = [3857, 102100, 102113, 900913];

// The geographic well-known IDs an ArcGIS service is likely to report an extent in. NAD83 isn't
// WGS84, but the two differ by about a meter, which is far below what a preview camera can show.
const GEOGRAPHIC_WKIDS = [4326, 4269, 4267];

// EPSG:3857 stops at these latitudes, but services round their extents outward past them
const MAX_LATITUDE = 90;

export type EsriSpatialReference = { wkid?: number; latestWkid?: number };

export type EsriExtent = {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
  spatialReference?: EsriSpatialReference;
};

// One zoom of a cached tile pyramid
export type EsriLevelOfDetail = { level: number; resolution: number; scale?: number };

// How a MapServer's cached tiles are cut up, when it has any
export type EsriTileInfo = {
  rows?: number;
  cols?: number;
  origin?: { x: number; y: number };
  spatialReference?: EsriSpatialReference;
  lods?: EsriLevelOfDetail[];
};

// The parts of a service or layer description we read. ArcGIS returns a great deal more.
export type EsriMetadata = {
  name?: string;
  capabilities?: string;
  extent?: EsriExtent;
  fullExtent?: EsriExtent;
  spatialReference?: EsriSpatialReference;
  singleFusedMapCache?: boolean;
  tileInfo?: EsriTileInfo;
  maxRecordCount?: number;
  objectIdFieldName?: string;
  supportedQueryFormats?: string;
  advancedQueryCapabilities?: { supportsPagination?: boolean };
};

// Esri JSON geometry: which key is present tells you the geometry type
export type EsriGeometry = {
  x?: number;
  y?: number;
  points?: GeoJSON.Position[];
  paths?: GeoJSON.Position[][];
  rings?: GeoJSON.Position[][];
  spatialReference?: EsriSpatialReference;
};

// One row of an /identify response: the attributes of a feature, plus where it was drawn
export type EsriIdentifyResult = {
  layerId?: number;
  layerName?: string;
  attributes?: Record<string, unknown>;
  geometry?: EsriGeometry | null;
};

// One row of a /query response asked for as Esri JSON rather than GeoJSON
export type EsriQueryFeature = { attributes?: Record<string, unknown>; geometry?: EsriGeometry | null };

// True if the given spatial reference is the Web Mercator grid MapLibre draws in
export const isWebMercator = (spatialReference?: EsriSpatialReference) => {
  if (!spatialReference) return false;
  return WEB_MERCATOR_WKIDS.includes(spatialReference.latestWkid ?? spatialReference.wkid ?? 0);
};

// True if the given spatial reference is in degrees of longitude and latitude
export const isGeographic = (spatialReference?: EsriSpatialReference) => {
  if (!spatialReference) return false;
  return GEOGRAPHIC_WKIDS.includes(spatialReference.latestWkid ?? spatialReference.wkid ?? 0);
};

// Convert an ArcGIS extent to bounds MapLibre can fit the camera to. Only the two coordinate
// systems we can convert without a projection library are handled; an extent in a state plane or
// national grid is left alone, so the camera stays wherever the record already put it.
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

  // A service can report an extent that reaches past the poles, which is beyond what a coordinate
  // can express - LngLat rejects it rather than clamping, which would fail the whole preview
  const clampLatitude = ([lng, lat]: [number, number]): [number, number] => [lng, Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, lat))];

  return new LngLatBounds(clampLatitude(southWest), clampLatitude(northEast));
};

// Bounds as the flat west,south,east,north array a MapLibre source takes to limit its requests
export const esriExtentToSourceBounds = (extent?: EsriExtent): [number, number, number, number] | undefined => {
  const bounds = esriExtentToBounds(extent);
  if (!bounds) return undefined;
  const [[west, south], [east, north]] = (bounds as LngLatBounds).toArray();
  return [west, south, east, north];
};

// Twice the area enclosed by a ring, signed: negative when its points run clockwise
const signedArea = (ring: GeoJSON.Position[]) => {
  let total = 0;
  for (let i = 0, previous = ring.length - 1; i < ring.length; previous = i++) {
    total += ring[previous][0] * ring[i][1] - ring[i][0] * ring[previous][1];
  }
  return total;
};

// Esri lists every ring of a polygon in one flat array and tells the outlines from the holes by
// which way their points run: clockwise encloses area, counter-clockwise cuts a hole out of the
// outline before it. GeoJSON nests them instead, so start a new polygon at each clockwise ring.
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

// Convert an Esri JSON geometry to GeoJSON, in whatever coordinate system it arrived in
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

// Convert the rows of an /identify response into features the popup and the map can use. The
// features have no IDs of their own, so number them; the selection is drawn from this list.
export const esriIdentifyResultsToFeatures = (results: EsriIdentifyResult[] = []): GeoJSON.Feature[] =>
  results.map((result, index) => ({
    type: 'Feature',
    id: index,
    geometry: esriGeometryToGeoJSON(result.geometry) as GeoJSON.Geometry,
    properties: (result.attributes ?? {}) as GeoJSON.GeoJsonProperties,
  }));

// Convert the rows of a /query response asked for as Esri JSON into GeoJSON features
export const esriQueryFeaturesToGeoJSON = (features: EsriQueryFeature[] = [], objectIdFieldName = 'OBJECTID'): GeoJSON.Feature[] =>
  features.map((feature, index) => ({
    type: 'Feature',
    id: (feature.attributes?.[objectIdFieldName] as string | number) ?? index,
    geometry: esriGeometryToGeoJSON(feature.geometry) as GeoJSON.Geometry,
    properties: (feature.attributes ?? {}) as GeoJSON.GeoJsonProperties,
  }));

// ArcGIS reports a failed request as HTTP 200 with an error object in the body, so a request that
// went wrong looks like one that worked until we read it. Re-raise it as the HTTP error it should
// have been, so it reaches the user as the same alert any other failed reference would.
export const throwOnEsriError = <T>(body: T, url: string): T => {
  const error = (body as { error?: { code?: number; message?: string; details?: string[] } })?.error;
  if (!error) return body;

  const message = [error.message, ...(error.details ?? [])].filter(Boolean).join(' ');
  throw new HttpError(url, error.code ?? 500, message || 'ArcGIS request failed');
};

// Fetch the JSON description of an ArcGIS resource, raising both HTTP and ArcGIS-level failures
export const fetchEsriJson = async <T = EsriMetadata>(url: string, params: Record<string, string> = {}, requestTransform?: RequestTransform): Promise<T> => {
  const requestUrl = new URL(url);
  Object.entries({ f: 'json', ...params }).forEach(([key, value]) => requestUrl.searchParams.set(key, value));

  const { url: resolvedUrl, init } = resolveRequest(requestUrl.toString(), 'metadata', requestTransform);
  const response = await fetchOrThrow(resolvedUrl, init);
  return throwOnEsriError((await response.json()) as T, resolvedUrl);
};

// True if the service publishes the named capability, e.g. 'Query' on a MapServer that can be
// asked what lies under a click, or 'TilesOnly' on one that can only hand back cached tiles
export const hasCapability = (metadata: EsriMetadata, capability: string) =>
  (metadata.capabilities ?? '')
    .split(',')
    .map(entry => entry.trim())
    .includes(capability);

// A reference can point either at a whole ArcGIS service or at one layer inside it, e.g.
// .../MapServer or .../MapServer/0. Requests go to the service either way, so split the layer off.
export const splitEsriLayerUrl = (url: string): { serviceUrl: string; layerId?: string } => {
  const trimmed = url.replace(/\/+$/, '');
  const match = trimmed.match(/^(?<serviceUrl>.+)\/(?<layerId>\d+)$/);
  if (!match?.groups) return { serviceUrl: trimmed };
  return { serviceUrl: match.groups.serviceUrl, layerId: match.groups.layerId };
};
