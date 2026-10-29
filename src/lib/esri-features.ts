import { addProtocol, type GetResourceResponse, type RequestParameters } from 'maplibre-gl';
import { geoJSONToTile } from '@maplibre/geojson-vt';
import { fromGeojsonVt } from '@maplibre/vt-pbf';

import { ESRI_VECTOR_LAYER } from './esri';

export const ESRI_FEATURES_SCHEME = 'esri-features';

// Match MapLibre's GeoJSON tiler extent and buffer so tile geometry aligns with other sources.
export const TILE_EXTENT = 4096;
export const TILE_BUFFER = 64;

export const TILE_BUFFER_RATIO = TILE_BUFFER / TILE_EXTENT;

const TILE_TOLERANCE = 3;

const TILE_CACHE_SIZE = 128;

export type EsriFeatureTiler = {
  fetchTile(z: number, x: number, y: number, signal?: AbortSignal): Promise<ArrayBuffer | undefined>;
};

const tilers = new Map<string, EsriFeatureTiler>();

const cache = new Map<string, Uint8Array>();

// MapLibre treats an empty buffer as a successfully loaded tile with no layers.
const emptyTile = (): ArrayBuffer => new ArrayBuffer(0);

let instances = 0;

export const featureTileUrl = (token: string): string => `${ESRI_FEATURES_SCHEME}://${encodeURIComponent(token)}/{z}/{x}/{y}`;

export const featureTileToken = (sourceId: string): string => `${sourceId}-${++instances}`;

export const parseFeatureTileUrl = (url: string): { token: string; z: number; x: number; y: number } | undefined => {
  const match = url.match(/^esri-features:\/\/(?<token>[^/]+)\/(?<z>\d+)\/(?<x>\d+)\/(?<y>\d+)$/);
  if (!match?.groups) return undefined;

  const { token, z, x, y } = match.groups;
  return { token: decodeURIComponent(token), z: Number(z), x: Number(x), y: Number(y) };
};

export const registerFeatureTiler = (token: string, tiler: EsriFeatureTiler) => tilers.set(token, tiler);

export const unregisterFeatureTiler = (token: string) => {
  tilers.delete(token);
  [...cache.keys()].filter(key => key.startsWith(`${token}/`)).forEach(key => cache.delete(key));
};

export const encodeFeatureTile = (features: GeoJSON.Feature[], z: number, x: number, y: number, objectIdField: string): ArrayBuffer | undefined => {
  const tile = geoJSONToTile({ type: 'FeatureCollection', features }, z, x, y, {
    extent: TILE_EXTENT,
    buffer: TILE_BUFFER,
    tolerance: TILE_TOLERANCE,
    promoteId: objectIdField,

    clip: true,

    wrap: false,
  });

  if (!tile?.features.length) return undefined;

  // vt-pbf uses an older geojson-vt type for the same tile shape.
  const layers = { [ESRI_VECTOR_LAYER]: tile } as unknown as Parameters<typeof fromGeojsonVt>[0];
  const bytes = fromGeojsonVt(layers, { version: 2, extent: TILE_EXTENT });

  return copyOf(bytes);
};

export const esriFeatureTile = async (params: RequestParameters, abortController: AbortController): Promise<GetResourceResponse<ArrayBuffer>> => {
  const parsed = parseFeatureTileUrl(params.url);

  if (!parsed) {
    console.warn(`Could not read ${params.url} as a request for ArcGIS features.`);
    return { data: emptyTile() };
  }

  const { token, z, x, y } = parsed;
  const tiler = tilers.get(token);
  if (!tiler) {
    console.warn(`No ArcGIS feature layer is registered to draw ${params.url}.`);
    return { data: emptyTile() };
  }

  const key = `${token}/${z}/${x}/${y}`;
  const cached = cache.get(key);
  if (cached) return { data: copyOf(cached) };

  const data = await tiler.fetchTile(z, x, y, abortController.signal);
  if (!data) return { data: emptyTile() };

  // Keep a copy because MapLibre transfers the returned buffer to a worker and detaches it.
  remember(key, new Uint8Array(data.slice(0)));
  return { data };
};

addProtocol(ESRI_FEATURES_SCHEME, esriFeatureTile);

// Return independent bytes so transferring a tile never detaches its cached copy.
const copyOf = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer as ArrayBuffer;

const remember = (key: string, bytes: Uint8Array) => {
  cache.set(key, bytes);
  if (cache.size <= TILE_CACHE_SIZE) return;

  const oldest = cache.keys().next().value;
  if (oldest !== undefined) cache.delete(oldest);
};
