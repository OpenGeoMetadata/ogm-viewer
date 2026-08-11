import { LngLatBounds, MercatorCoordinate, type LngLatLike } from 'maplibre-gl';
import { wktToGeoJSON } from '@terraformer/wkt';

// Regular expression to match ENVELOPE syntax in bbox strings
export const ENVELOPE_REGEX = /^ENVELOPE\((?<west>[^,]+),(?<east>[^,]+),(?<north>[^,]+),(?<south>[^,]+)\)$/;

// EPSG:3857 spans this many meters from the origin on both axes
const MERCATOR_EXTENT = 20037508.342789244;

// Where a box's east edge is, counted onward from its west edge rather than from Greenwich. A box
// that crosses the antimeridian is written with its east edge numerically west of its west edge -
// Solr's ENVELOPE syntax and RFC 7946 section 5.2 both say so - and taken at face value that
// describes the rest of the world instead: the 295 degrees a map of the Bering Strait doesn't cover.
// Carrying the east edge past 180 rather than wrapping it back keeps the box in one piece, which is
// what MapLibre needs both to draw an edge the short way round and to frame a camera on the half of
// the world the record is actually on. It hands back a longitude outside -180..180, which MapLibre
// reads everywhere it takes one; only a consumer that has to state a coordinate rather than use it
// needs to wrap it, and none here does.
const unwrapEast = (west: number, east: number) => (east < west ? east + 360 : east);

// Convert LngLatBounds to GeoJSON Polygon
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

// Convert an ENVELOPE format string into LngLatBounds
export const bboxToBounds = (bbox: string) => {
  // Try to parse bbox in ENVELOPE syntax
  const coords = bbox.match(ENVELOPE_REGEX);
  if (!coords) return;

  // Convert to numbers and create LngLatBounds
  const { west, east, north, south } = coords.groups!;
  return new LngLatBounds([parseFloat(west), parseFloat(south)], [unwrapEast(parseFloat(west), parseFloat(east)), parseFloat(north)]);
};

// Convert a geographic coordinate to EPSG:3857 (Web Mercator) meters
export const lngLatToMercator = (lngLat: LngLatLike): [number, number] => {
  // MercatorCoordinate is normalized to 0..1, with y increasing southward
  const { x, y } = MercatorCoordinate.fromLngLat(lngLat);
  return [(x * 2 - 1) * MERCATOR_EXTENT, (1 - y * 2) * MERCATOR_EXTENT];
};

// Axis-aligned envelope around the given coordinates, as the minx,miny,maxx,maxy
// string in EPSG:3857 meters that OGC services expect for a BBOX parameter
export const mercatorBbox = (coords: LngLatLike[]) => {
  const points = coords.map(lngLatToMercator);
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].join(',');
};

// The small square of the map we ask a service about when inspecting: a width x height grid of
// pixels laid over an EPSG:3857 bbox, with x,y naming the pixel to ask about, counted from the top
// left corner. The bbox and the grid describe each other, so a service can locate the pixel either
// by its place in the grid, as WMS GetFeatureInfo does, or as a coordinate, as ArcGIS does.
export type PixelWindow = {
  bbox: string; // minx,miny,maxx,maxy in EPSG:3857 meters
  width: number; // grid width in pixels
  height: number; // grid height in pixels
  x: number; // column to inspect, counted from the left edge
  y: number; // row to inspect, counted from the top edge
};

// The EPSG:3857 coordinate at the middle of the window's x,y pixel, along with how many meters
// across that pixel is - which is also the finest detail worth asking a service to draw back.
export const pixelWindowCenter = (window: PixelWindow) => {
  const [minX, minY, maxX, maxY] = window.bbox.split(',').map(Number);
  const resolution = (maxX - minX) / window.width;
  return {
    x: minX + (window.x + 0.5) * resolution,
    y: maxY - (window.y + 0.5) * ((maxY - minY) / window.height),
    resolution,
  };
};

// Convert an EPSG:3857 (Web Mercator) coordinate in meters back to a geographic coordinate
export const mercatorToLngLat = ([x, y]: GeoJSON.Position): [number, number] => {
  const { lng, lat } = new MercatorCoordinate((x / MERCATOR_EXTENT + 1) / 2, (1 - y / MERCATOR_EXTENT) / 2).toLngLat();
  return [lng, lat];
};

// Coordinates nest to a different depth for each geometry type - a Point holds a single position,
// a Polygon holds rings of them - so recurse until we reach a position
type Positions = GeoJSON.Position | GeoJSON.Position[] | GeoJSON.Position[][] | GeoJSON.Position[][][];
const mercatorPositionsToLngLat = (coordinates: Positions): Positions => {
  if (typeof coordinates[0] === 'number') return mercatorToLngLat(coordinates as GeoJSON.Position);
  return (coordinates as Positions[]).map(mercatorPositionsToLngLat) as Positions;
};

// Reproject a GeoJSON geometry from EPSG:3857 meters to geographic coordinates. OGC services
// answer in the CRS the request asked for, but MapLibre sources are always in degrees.
export const mercatorGeomToLngLat = (geometry: GeoJSON.Geometry): GeoJSON.Geometry => {
  if (geometry.type === 'GeometryCollection') {
    return { ...geometry, geometries: geometry.geometries.map(mercatorGeomToLngLat) };
  }
  return { ...geometry, coordinates: mercatorPositionsToLngLat(geometry.coordinates) } as GeoJSON.Geometry;
};

// Convert either WKT or ENVELOPE format geometry to GeoJSON
// If WKT parsing fails, try ENVELOPE instead
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
