import { LngLatBounds } from 'maplibre-gl';
import { wktToGeoJSON } from '@terraformer/wkt';

// Regular expression to match ENVELOPE syntax in bbox strings
export const ENVELOPE_REGEX = /^ENVELOPE\((?<west>[^,]+),(?<east>[^,]+),(?<north>[^,]+),(?<south>[^,]+)\)$/;

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
  if (!coords) return null;
  if (coords.length !== 5) return null;

  // Convert to numbers and create LngLatBounds
  const west = parseFloat(coords.groups.west);
  const east = parseFloat(coords.groups.east);
  const north = parseFloat(coords.groups.north);
  const south = parseFloat(coords.groups.south);
  return new LngLatBounds([west, south, east, north]);
};

// Convert either WKT or ENVELOPE format geometry to GeoJSON
// If WKT parsing fails, try ENVELOPE instead
export const geomToGeoJSON = (geometry: string): object => {
  try {
    return wktToGeoJSON(geometry);
  } catch (error) {
    const bounds = bboxToBounds(geometry);
    if (bounds) {
      return boundsToGeoJSON(bounds);
    }
    console.warn('Could not parse geometry:', geometry);
    return null;
  }
};
