import geojsonExtent from '@mapbox/geojson-extent';
import { LngLatBounds, type LngLatBoundsLike } from 'maplibre-gl';

import Resource, { type ResourceKind } from './resource';
import { boundsToGeoJSON } from '../geometry';

// Whether a caller handed us a shape or a box to make one from. A GeoJSON geometry is the only one
// of the two that names its own type; every form of LngLatBoundsLike is an array, or an object with
// corners rather than coordinates.
const isGeometry = (location: GeoJSON.Geometry | LngLatBoundsLike): location is GeoJSON.Geometry =>
  typeof location === 'object' && location !== null && 'type' in location && 'coordinates' in location;

/**
 * Where a record is, for when what it holds can't be drawn on a map - it sits behind authentication,
 * or nothing here can read the format, or it is a scan with no georeferencing to place it by, or the
 * preview was tried and failed. Knowing roughly what part of the world a thing covers is worth a
 * great deal on its own, and is most of what a reader wants from a map they can't yet see.
 *
 * The one resource that fetches nothing: the shape is handed over at construction rather than read
 * from a URL, so this draws immediately and can't fail. A geometry is preferred over a bounding box
 * where a caller has one - a record's `locn_geometry` may describe an archipelago or a coastline,
 * and squaring that off to its envelope claims coverage it doesn't have.
 */
export default class LocationResource extends Resource {
  readonly kind: ResourceKind = 'location';

  // The shape to draw, in lng/lat
  private geometry: GeoJSON.Geometry;

  constructor(id: string, location: GeoJSON.Geometry | LngLatBoundsLike) {
    const geometry = isGeometry(location) ? location : (boundsToGeoJSON(LngLatBounds.convert(location)) as GeoJSON.Geometry);
    // No URL, because there is nothing to go and get. Resource.url is a string rather than an
    // optional one because every other resource has somewhere to point and reads it without asking,
    // and widening it for this one would put a `?? ''` at each of those sites instead of here.
    super(id, '', extentOf(geometry));
    this.geometry = geometry;
  }

  label(): string {
    return 'Location';
  }

  // Nothing to reach, so nothing that could be unreachable. The base class would HEAD the empty
  // URL above and call this resource broken.
  async test(): Promise<boolean> {
    return true;
  }

  // The shape itself, for the previewer to put on the map
  getGeometry(): GeoJSON.Geometry {
    return this.geometry;
  }
}

// Where to point the map to see the whole shape. Worked out here rather than left to the previewer
// so that a caller who passed a geometry gets the same camera behaviour as one who passed a box.
const extentOf = (geometry: GeoJSON.Geometry): LngLatBoundsLike | undefined => {
  const extent = geojsonExtent({ type: 'Feature', properties: {}, geometry });
  if (!extent) return undefined;
  return [
    [extent[0], extent[1]],
    [extent[2], extent[3]],
  ];
};
