import geojsonExtent from '@mapbox/geojson-extent';
import { LngLatBounds, type LngLatBoundsLike } from 'maplibre-gl';

import Resource, { type ResourceKind } from './resource';
import { boundsToGeoJSON } from '../geometry';

const isGeometry = (location: GeoJSON.Geometry | LngLatBoundsLike): location is GeoJSON.Geometry =>
  typeof location === 'object' && location !== null && 'type' in location && 'coordinates' in location;

export default class LocationResource extends Resource {
  readonly kind: ResourceKind = 'location';

  private geometry: GeoJSON.Geometry;

  constructor(id: string, location: GeoJSON.Geometry | LngLatBoundsLike) {
    const geometry = isGeometry(location) ? location : (boundsToGeoJSON(LngLatBounds.convert(location)) as GeoJSON.Geometry);
    super(id, '', extentOf(geometry));
    this.geometry = geometry;
  }

  label(): string {
    return 'Location';
  }

  async test(): Promise<boolean> {
    return true;
  }

  getGeometry(): GeoJSON.Geometry {
    return this.geometry;
  }
}

const extentOf = (geometry: GeoJSON.Geometry): LngLatBoundsLike | undefined => {
  const extent = geojsonExtent({ type: 'Feature', properties: {}, geometry });
  if (!extent) return undefined;
  return [
    [extent[0], extent[1]],
    [extent[2], extent[3]],
  ];
};
