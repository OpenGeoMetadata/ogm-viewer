import { LngLatBounds, MercatorCoordinate, type LngLatLike } from 'maplibre-gl';
import { wktToGeoJSON } from '@terraformer/wkt';

// Regular expression to match ENVELOPE syntax in bbox strings
export const ENVELOPE_REGEX = /^ENVELOPE\((?<west>[^,]+),(?<east>[^,]+),(?<north>[^,]+),(?<south>[^,]+)\)$/;

// EPSG:3857 spans this many meters from the origin on both axes
const MERCATOR_EXTENT = 20037508.342789244;

// Convert LngLatBounds to GeoJSON Polygon
export const boundsToGeoJSON = (bounds: LngLatBounds) => {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [bounds.getWest(), bounds.getSouth()],
        [bounds.getEast(), bounds.getSouth()],
        [bounds.getEast(), bounds.getNorth()],
        [bounds.getWest(), bounds.getNorth()],
        [bounds.getWest(), bounds.getSouth()],
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
  return new LngLatBounds([parseFloat(west), parseFloat(south)], [parseFloat(east), parseFloat(north)]);
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
