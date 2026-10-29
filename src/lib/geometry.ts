import { LngLat, LngLatBounds, MercatorCoordinate, type LngLatBoundsLike, type LngLatLike } from 'maplibre-gl';
import { wktToGeoJSON } from '@terraformer/wkt';

export const ENVELOPE_REGEX = /^ENVELOPE\((?<west>[^,]+),(?<east>[^,]+),(?<north>[^,]+),(?<south>[^,]+)\)$/;

const MERCATOR_EXTENT = 20037508.342789244;

const WORLD_SIZE = 512;

// Carry crossing east edges past 180 so MapLibre frames the short span across the antimeridian.
const unwrapEast = (west: number, east: number) => (east < west ? east + 360 : east);

export const boundsToGeoJSON = (bounds: LngLatBounds) => {
  const [west, south, north] = [bounds.getWest(), bounds.getSouth(), bounds.getNorth()];
  const east = unwrapEast(west, bounds.getEast());

  return {
    type: 'Polygon',
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ],
  };
};

export const unionBounds = (extents: (LngLatBoundsLike | undefined)[]): LngLatBounds | undefined => {
  const union = extents.reduce<LngLatBounds>((bounds, extent) => (extent ? bounds.extend(LngLatBounds.convert(extent)) : bounds), new LngLatBounds());
  return union.isEmpty() ? undefined : union;
};

const HEMISPHERE = 180;

export const clampToHemisphere = (extent: LngLatBoundsLike): LngLatBounds => {
  const bounds = LngLatBounds.convert(extent);
  const [west, east] = [bounds.getWest(), bounds.getEast()];
  if (east - west <= HEMISPHERE) return bounds;
  const middle = (west + east) / 2;
  return new LngLatBounds([middle - HEMISPHERE / 2, bounds.getSouth()], [middle + HEMISPHERE / 2, bounds.getNorth()]);
};

export const WORLD: LngLatBoundsLike = [
  [-180, -85],
  [180, 85],
];

export const bboxToBounds = (bbox: string) => {
  const coords = bbox.match(ENVELOPE_REGEX);
  if (!coords) return;

  const { west, east, north, south } = coords.groups!;
  return new LngLatBounds([parseFloat(west), parseFloat(south)], [unwrapEast(parseFloat(west), parseFloat(east)), parseFloat(north)]);
};

/** Read bounds or an ENVELOPE string, preserving antimeridian crossings; invalid input is undefined. */
export const readBounds = (bounds: LngLatBoundsLike | string): LngLatBounds | undefined => {
  const read = typeof bounds === 'string' ? (bboxToBounds(bounds) ?? boundsFromList(bounds)) : convertBounds(bounds);
  if (!read) return undefined;

  const west = read.getWest();
  return new LngLatBounds([west, read.getSouth()], [unwrapEast(west, read.getEast()), read.getNorth()]);
};

const boundsFromList = (bbox: string): LngLatBounds | undefined => {
  const edges = bbox.split(/[\s,]+/).filter(edge => edge !== '');
  if (edges.length !== 4 || !edges.every(edge => Number.isFinite(Number(edge)))) return undefined;
  return convertBounds(edges.map(Number) as [number, number, number, number]);
};

const convertBounds = (bounds: LngLatBoundsLike): LngLatBounds | undefined => {
  try {
    return LngLatBounds.convert(bounds);
  } catch {
    return undefined;
  }
};

// Keep in-range edges unchanged; MapLibre's wrap turns -180 into 180 and introduces rounding drift.
const wrapLongitude = (lng: number) => (lng >= -180 && lng <= 180 ? lng : new LngLat(lng, 0).wrap().lng);

export const boundsToBbox = (bounds: LngLatBounds): [number, number, number, number] => {
  const [[west, south], [east, north]] = bounds.toArray();

  // A view spanning the whole world must not wrap both edges onto the same longitude.
  if (east - west >= 360) return [-180, south, 180, north];

  return [wrapLongitude(west), south, wrapLongitude(east), north];
};

export const boundsOverlap = (a: LngLatBoundsLike, b: LngLatBoundsLike): boolean => {
  const [first, second] = [readBounds(a), readBounds(b)];
  if (!first || !second) return true;
  if (first.getSouth() > second.getNorth() || second.getSouth() > first.getNorth()) return false;
  const span = (bounds: LngLatBounds): [number, number] => {
    const west = wrapLongitude(bounds.getWest());
    return [west, west + (bounds.getEast() - bounds.getWest())];
  };
  const [[west1, east1], [west2, east2]] = [span(first), span(second)];
  if (east1 - west1 >= 360 || east2 - west2 >= 360) return true;
  return [-360, 0, 360].some(shift => west2 + shift <= east1 && west1 <= east2 + shift);
};

export const lngLatToMercator = (lngLat: LngLatLike): [number, number] => {
  const { x, y } = MercatorCoordinate.fromLngLat(lngLat);
  return [(x * 2 - 1) * MERCATOR_EXTENT, (1 - y * 2) * MERCATOR_EXTENT];
};

export const mercatorBbox = (coords: LngLatLike[]) => {
  const points = coords.map(lngLatToMercator);
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].join(',');
};

// Width and height of a WGS84 box in pixels at zoom 0; both double with each zoom level.
export const pixelSpan = ([west, south, east, north]: [number, number, number, number]): [width: number, height: number] => {
  const southwest = MercatorCoordinate.fromLngLat([west, south]);
  const northeast = MercatorCoordinate.fromLngLat([east, north]);
  return [Math.abs(northeast.x - southwest.x) * WORLD_SIZE, Math.abs(northeast.y - southwest.y) * WORLD_SIZE];
};

// Expand the query by the tiler buffer so shapes just outside a tile can still paint inside it.
export const tileBbox3857 = (z: number, x: number, y: number, bufferRatio = 0): [number, number, number, number] => {
  const span = (2 * MERCATOR_EXTENT) / 2 ** z;
  const buffer = span * bufferRatio;

  const west = -MERCATOR_EXTENT + x * span;
  const north = MERCATOR_EXTENT - y * span;

  return [west - buffer, north - span - buffer, west + span + buffer, north + buffer];
};

export const tileLngLatSpan = (z: number): number => 360 / 2 ** z;

export const tilesCovering = (bounds: LngLatBounds, zoom: number): number => {
  const [[west, south], [east, north]] = bounds.toArray();
  const [minX, minY] = lngLatToMercator([west, south]);
  const [maxX, maxY] = lngLatToMercator([east, north]);

  const world = 2 * MERCATOR_EXTENT;
  const tiles = 2 ** zoom;
  const across = Math.max(1, (Math.abs(maxX - minX) / world) * tiles);
  const down = Math.max(1, (Math.abs(maxY - minY) / world) * tiles);

  return across * down;
};

export type PixelWindow = {
  bbox: string; // minx,miny,maxx,maxy in EPSG:3857 meters
  width: number; // grid width in pixels
  height: number; // grid height in pixels
  x: number; // column to inspect, counted from the left edge
  y: number; // row to inspect, counted from the top edge
};

export const pixelWindowCenter = (window: PixelWindow) => {
  const [minX, minY, maxX, maxY] = window.bbox.split(',').map(Number);
  const resolution = (maxX - minX) / window.width;
  return {
    x: minX + (window.x + 0.5) * resolution,
    y: maxY - (window.y + 0.5) * ((maxY - minY) / window.height),
    resolution,
  };
};

export const mercatorToLngLat = ([x, y]: GeoJSON.Position): [number, number] => {
  const { lng, lat } = new MercatorCoordinate((x / MERCATOR_EXTENT + 1) / 2, (1 - y / MERCATOR_EXTENT) / 2).toLngLat();
  return [lng, lat];
};

type Positions = GeoJSON.Position | GeoJSON.Position[] | GeoJSON.Position[][] | GeoJSON.Position[][][];
const mercatorPositionsToLngLat = (coordinates: Positions): Positions => {
  if (typeof coordinates[0] === 'number') return mercatorToLngLat(coordinates as GeoJSON.Position);
  return (coordinates as Positions[]).map(mercatorPositionsToLngLat) as Positions;
};

export const mercatorGeomToLngLat = (geometry: GeoJSON.Geometry): GeoJSON.Geometry => {
  if (geometry.type === 'GeometryCollection') {
    return { ...geometry, geometries: geometry.geometries.map(mercatorGeomToLngLat) };
  }
  return { ...geometry, coordinates: mercatorPositionsToLngLat(geometry.coordinates) } as GeoJSON.Geometry;
};

export const geomToGeoJSON = (geometry: string) => {
  try {
    return wktToGeoJSON(geometry) as GeoJSON.Geometry;
  } catch (error) {
    const bounds = bboxToBounds(geometry);
    if (bounds) {
      return boundsToGeoJSON(bounds) as GeoJSON.Geometry;
    }
    console.warn('Could not parse geometry:', geometry);
    return;
  }
};
