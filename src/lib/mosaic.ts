import { pixelSpan } from './geometry';

export type MosaicSheet = { id: string; url: string; bbox: [west: number, south: number, east: number, north: number] };

const GEOTIFF_PATH = /\.tiff?$/i;

const MOSAIC_SHARE = 0.5;

const MOST_SHEETS_IN_VIEW = 256;

const VIEW_AREA = 1024 * 768;

const httpUrl = (value: unknown): URL | undefined => {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
};

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

// Exclude antimeridian-crossing sheets because a single mosaic box would cover the wrong hemisphere.
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

export function mosaicSheets(collection: unknown): MosaicSheet[] {
  const byOutline = new Map<string, MosaicSheet>();

  for (const sheet of geotiffSheets(collection)) byOutline.set(sheet.bbox.join(), sheet);

  return [...byOutline.values()];
}

const geotiffSheets = (collection: unknown): MosaicSheet[] =>
  featuresOf(collection).flatMap(feature => {
    const properties = feature.properties ?? {};
    if (properties.available === false) return [];

    const url = httpUrl(properties.download);
    if (!url || !GEOTIFF_PATH.test(url.pathname)) return [];

    const bbox = bboxOf(feature.geometry);
    return bbox ? [{ id: url.href, url: url.href, bbox }] : [];
  });

export function offersMosaic(collection: unknown): boolean {
  const downloads = featuresOf(collection).filter(feature => httpUrl(feature.properties?.download)).length;
  return geotiffSheets(collection).length >= downloads * MOSAIC_SHARE && mosaicSheets(collection).length >= 2;
}

// Estimate the zoom from median sheet area so a few overview sheets do not dominate it.
export function mosaicMinZoom(sheets: MosaicSheet[]): number {
  const areas = sheets
    .map(sheet => pixelSpan(sheet.bbox))
    .map(([width, height]) => width * height)
    .sort((a, b) => a - b);
  const median = areas[Math.floor(areas.length / 2)];
  if (!median) return 0;

  return Math.max(0, Math.round(0.5 * Math.log2(VIEW_AREA / (MOST_SHEETS_IN_VIEW * median))));
}
