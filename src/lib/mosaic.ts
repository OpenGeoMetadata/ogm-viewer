import { MercatorCoordinate } from 'maplibre-gl';

/**
 * The sheets of an index map that can be drawn as one mosaic, and what it takes to draw them.
 *
 * Kept apart from IndexMapMosaic, which draws them and loads deck.gl: whether an index map is worth a
 * mosaic at all is asked of every index map a record has, and only one whose sheets turn out to link
 * GeoTIFFs should pay for the chunk that draws them.
 */

// One sheet that goes into a mosaic: the COG it links, and the box the sheet covers, in WGS84
// [west, south, east, north] - which is what MosaicLayer indexes them by and tests against the view.
// The id is the URL, so a sheet keeps its place in deck.gl's cache whatever else the list does.
export type MosaicSheet = { id: string; url: string; bbox: [west: number, south: number, east: number, north: number] };

// A download that names a GeoTIFF. Only a guess at a COG - a GeoTIFF needn't be tiled, and plenty
// aren't - so the first sheet is read before the mosaic's row is offered; see IndexMapMosaic.canDraw.
const GEOTIFF_PATH = /\.tiff?$/i;

// How many of the sheets that link a download have to link a GeoTIFF for the index map to be worth a
// mosaic. Most, rather than all: an index map is an export of someone's shapefile, and one sheet with
// a broken link shouldn't cost the rest of them their mosaic.
const MOSAIC_SHARE = 0.5;

// How many sheets a view can take before the mosaic stops drawing. Every sheet in view costs a read
// of its header before anything of it can be drawn - one range request for a 3DEP tile, a few for an
// HTMC scan - plus its coarsest tiles, and S3 answers six requests at a time. This many open in a few
// seconds, and hold a few hundred megabytes of a DEM's textures between them. Each fourfold step up
// takes the floor out one zoom level; 64 kept it one level in, at about a second.
const MOST_SHEETS_IN_VIEW = 256;

// The view that count is measured against, in CSS pixels: a laptop's map pane, near enough
const VIEW_AREA = 1024 * 768;

// How wide the world is at zoom 0, in the pixels MapLibre and deck.gl both count zoom in
const WORLD_SIZE = 512;

// An http(s) URL, or nothing - the same test the sheet popup puts a link through
const httpUrl = (value: unknown): URL | undefined => {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
};

// Every position of a sheet's outline, whichever kind of polygon it is
const positionsOf = (geometry: GeoJSON.Geometry | null | undefined): GeoJSON.Position[] => {
  switch (geometry?.type) {
    case 'Polygon':
      return geometry.coordinates.flat();
    case 'MultiPolygon':
      return geometry.coordinates.flat(2);
    default:
      return [];
  }
};

// The box around a sheet's outline. Undefined for a sheet with no outline, and for one whose box would
// be the long way round the world: a sheet straddling the antimeridian lists its corners on both sides
// of it, and the box around those spans everything in between instead of the sheet.
const bboxOf = (geometry: GeoJSON.Geometry | null | undefined): MosaicSheet['bbox'] | undefined => {
  const positions = positionsOf(geometry);
  if (!positions.length) return undefined;

  const xs = positions.map(([x]) => x);
  const ys = positions.map(([, y]) => y);
  const bbox: MosaicSheet['bbox'] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  return bbox[2] - bbox[0] > 180 ? undefined : bbox;
};

const featuresOf = (collection: unknown): GeoJSON.Feature[] => {
  const { features } = (collection ?? {}) as { features?: unknown };
  return Array.isArray(features) ? features : [];
};

/**
 * The sheets of an index map that can go into a mosaic: those the index map says are available, that
 * link a GeoTIFF download and have an outline to put it in. In the index map's own order.
 *
 * One sheet per outline. An index map can list every edition of a sheet - HTMC's list up to fifteen
 * printings of the same quad, oldest first - and deck.gl draws overlapping sources in whatever order
 * it first asked for them, not in the order they're listed, so a stack would come out shuffled. The
 * last listed of a stack is kept, which is the edition GeoJsonPreviewer labels the stack with.
 */
export function mosaicSheets(collection: unknown): MosaicSheet[] {
  const byOutline = new Map<string, MosaicSheet>();

  // Set again rather than skipped, so the later edition wins; a Map keeps the place of the first
  for (const sheet of geotiffSheets(collection)) byOutline.set(sheet.bbox.join(), sheet);

  return [...byOutline.values()];
}

// Every available sheet that links a GeoTIFF and has an outline, editions and all
const geotiffSheets = (collection: unknown): MosaicSheet[] =>
  featuresOf(collection).flatMap(feature => {
    const properties = feature.properties ?? {};
    if (properties.available === false) return [];

    const url = httpUrl(properties.download);
    if (!url || !GEOTIFF_PATH.test(url.pathname)) return [];

    const bbox = bboxOf(feature.geometry);
    return bbox ? [{ id: url.href, url: url.href, bbox }] : [];
  });

/**
 * Whether an index map is worth a mosaic: its sheets fill at least two outlines, and most of the
 * sheets that link a download at all link a GeoTIFF. Counted before editions are folded together -
 * an index map of fifteen printings per quad is still all GeoTIFFs. Read off the GeoJSON alone, so it
 * costs nothing beyond the index map itself.
 */
export function offersMosaic(collection: unknown): boolean {
  const downloads = featuresOf(collection).filter(feature => httpUrl(feature.properties?.download)).length;
  return geotiffSheets(collection).length >= downloads * MOSAIC_SHARE && mosaicSheets(collection).length >= 2;
}

// How much of the Web Mercator plane a sheet covers, as a fraction of the whole of it. MapLibre's
// MercatorCoordinate is already that fraction, running 0 to 1 across the plane each way.
const mercatorArea = ([west, south, east, north]: MosaicSheet['bbox']): number => {
  const southwest = MercatorCoordinate.fromLngLat([west, south]);
  const northeast = MercatorCoordinate.fromLngLat([east, north]);
  return Math.abs(northeast.x - southwest.x) * Math.abs(northeast.y - southwest.y);
};

/**
 * The zoom below which a mosaic of these sheets isn't drawn: the one where a view holds about
 * MOST_SHEETS_IN_VIEW sheets of the typical size. A sheet of a fraction `a` of the plane covers
 * `a * (512 * 2^z)^2` pixels at zoom z, so that many fit in the view once `2^2z` reaches
 * `VIEW_AREA / (MOST_SHEETS_IN_VIEW * a * 512^2)`.
 *
 * Typical is the median, so a few outsized sheets - an overview sheet in a series of quads - don't
 * decide it. Rounded to a whole zoom, because that is what deck.gl goes by: Tileset2D rounds a
 * fractional minZoom up, so anything finer would leave the notice saying one thing and the mosaic
 * doing another. Rounded rather than raised, which keeps a view within a factor of two of the target
 * either way. 5 for 3DEP's one-degree tiles, and 8 for 7.5-minute quads.
 */
export function mosaicMinZoom(sheets: MosaicSheet[]): number {
  const areas = sheets.map(sheet => mercatorArea(sheet.bbox)).sort((a, b) => a - b);
  const median = areas[Math.floor(areas.length / 2)];
  if (!median) return 0;

  return Math.max(0, Math.round(0.5 * Math.log2(VIEW_AREA / (MOST_SHEETS_IN_VIEW * median * WORLD_SIZE ** 2))));
}
