import maplibregl, { type GetResourceResponse, type RequestParameters } from 'maplibre-gl';
import { geoJSONToTile } from '@maplibre/geojson-vt';
import { fromGeojsonVt } from '@maplibre/vt-pbf';

import { ESRI_VECTOR_LAYER } from './esri';

// The scheme a tiled ArcGIS feature source is addressed under. Not a real one: MapLibre asks for
// tiles by URL, so a URL is the only channel a source has to say which layer its tiles come from.
export const ESRI_FEATURES_SCHEME = 'esri-features';

// A tile's coordinate space, and how far past its own edges features are kept. MapLibre's own
// GeoJSON source uses these numbers, so a tile built with them is drawn at the detail every other
// vector source on the map is. See tileBbox3857 for why the buffer has to reach the query too.
export const TILE_EXTENT = 4096;
export const TILE_BUFFER = 64;

// How much of a tile's own width the query has to reach past its edges to fill that buffer
export const TILE_BUFFER_RATIO = TILE_BUFFER / TILE_EXTENT;

// Line and polygon detail is thrown away below this many tile units, which is a third of a screen
// pixel at the zoom the tile was cut for. geojson-vt's own default.
const TILE_TOLERANCE = 3;

// How many finished tiles to keep. Worth having because a basemap swap rebuilds the style document
// and re-requests every tile on it, and a reader who pans back where they were should not pay for
// that view twice either.
const TILE_CACHE_SIZE = 128;

// What answers for one source's tiles: the resource that knows the layer, its fields and how to ask
// for them. Undefined for a tile with nothing in it.
export type EsriFeatureTiler = {
  fetchTile(z: number, x: number, y: number, signal?: AbortSignal): Promise<ArrayBuffer | undefined>;
};

// Live tilers by token. The handler is registered once for the whole page, so this is how it finds
// the one resource a tile URL belongs to - a requestTransform is a function and can't ride in a URL.
const tilers = new Map<string, EsriFeatureTiler>();

// Finished tiles by token and coordinate, oldest first
const cache = new Map<string, Uint8Array>();

// An empty vector tile. MapLibre reads a zero-length body as a tile with no layers in it, which is
// what a tile of ocean is, and reports it as loaded rather than failed.
const EMPTY_TILE = new ArrayBuffer(0);

// Distinct per source, and per copy of a source: two viewers of the same record on one page can
// carry different request transforms, and a token is what tells their tiles apart.
let instances = 0;

// The URL template a tiled source is given, with MapLibre's own placeholders left in it for MapLibre
// to fill. Sanitized because the token comes from a record's id, which is whatever the record says.
export const featureTileUrl = (token: string): string => `${ESRI_FEATURES_SCHEME}://${encodeURIComponent(token)}/{z}/{x}/{y}`;

export const featureTileToken = (sourceId: string): string => `${sourceId}-${++instances}`;

// Pull a tile request apart again. Anything that isn't one of ours is nothing we can answer.
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

// Build one tile out of features already scoped to it. Handed the ObjectID field so the tile's
// features keep the service's own ids: MapLibre's setFeatureState works from a feature id, so a
// selection or a hover survives the tile being dropped and read again only if the id does.
export const encodeFeatureTile = (features: GeoJSON.Feature[], z: number, x: number, y: number, objectIdField: string): ArrayBuffer | undefined => {
  const tile = geoJSONToTile({ type: 'FeatureCollection', features }, z, x, y, {
    extent: TILE_EXTENT,
    buffer: TILE_BUFFER,
    tolerance: TILE_TOLERANCE,
    promoteId: objectIdField,

    // Clipped to the buffered box, which is the box the features were asked for, so whatever a
    // loose spatial relationship let through is dropped here rather than drawn twice
    clip: true,

    // One tile, one world: a query answers about the box it was given and nothing across the
    // antimeridian from it
    wrap: false,
  });

  if (!tile?.features.length) return undefined;

  // Cast because vt-pbf declares an older range of geojson-vt than the one hoisted here and so
  // carries its own copy of the types, which describe the same tile with one field non-optional.
  // maplibre-gl pairs these two exact versions itself, so this is the pairing already in use.
  const layers = { [ESRI_VECTOR_LAYER]: tile } as unknown as Parameters<typeof fromGeojsonVt>[0];
  const bytes = fromGeojsonVt(layers, { version: 2, extent: TILE_EXTENT });

  // A copy, not the view finish() hands back: that one is a window onto a buffer deliberately
  // allocated larger than the tile, and its .buffer carries whatever else is in there
  return copyOf(bytes);
};

// Answer a tile request from whichever resource owns the source that asked. Registered at module
// scope, once for the page, the way the PMTiles protocol is. Exported so it can be tested for what
// it does rather than through MapLibre's own protocol registry, which is private.
export const esriFeatureTile = async (params: RequestParameters, abortController: AbortController): Promise<GetResourceResponse<ArrayBuffer>> => {
  const parsed = parseFeatureTileUrl(params.url);

  // A source can outlive the previewer that put it there - a record swapped while its tiles were in
  // flight - and a tile nobody is waiting for is not a failure worth alerting anyone about
  if (!parsed) {
    console.warn(`Could not read ${params.url} as a request for ArcGIS features.`);
    return { data: EMPTY_TILE };
  }

  const { token, z, x, y } = parsed;
  const tiler = tilers.get(token);
  if (!tiler) {
    console.warn(`No ArcGIS feature layer is registered to draw ${params.url}.`);
    return { data: EMPTY_TILE };
  }

  const key = `${token}/${z}/${x}/${y}`;
  const cached = cache.get(key);
  if (cached) return { data: copyOf(cached) };

  const data = await tiler.fetchTile(z, x, y, abortController.signal);
  if (!data) return { data: EMPTY_TILE };

  remember(key, new Uint8Array(data));
  return { data };
};

maplibregl.addProtocol(ESRI_FEATURES_SCHEME, esriFeatureTile);

// A tile of its own bytes and nothing else. Every tile handed to MapLibre has to be one of these:
// the buffer is transferred to the worker rather than copied, which leaves ours detached - so a
// cached tile served twice would be served empty the second time.
const copyOf = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer as ArrayBuffer;

const remember = (key: string, bytes: Uint8Array) => {
  cache.set(key, bytes);
  if (cache.size <= TILE_CACHE_SIZE) return;

  // Map keeps insertion order, so the first key is the one held longest
  const oldest = cache.keys().next().value;
  if (oldest !== undefined) cache.delete(oldest);
};
