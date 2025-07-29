import { LngLatBounds } from 'maplibre-gl';
import { bboxToBounds, boundsToGeoJSON, geomToGeoJSON } from '../geometry';

describe('geomToGeoJSON', () => {
  it('should convert WKT to GeoJSON', () => {
    const wkt = 'POINT (-122.6764 45.5165)';
    const geojson = geomToGeoJSON(wkt);
    expect(geojson).toEqual({
      type: 'Point',
      coordinates: [-122.6764, 45.5165],
    });
  });

  it('should convert ENVELOPE to GeoJSON', () => {
    const bbox = 'ENVELOPE(-20,-15,-5,-1)';
    const geojson = geomToGeoJSON(bbox);
    expect(geojson).toEqual({
      type: 'Polygon',
      coordinates: [
        [
          [-20, -1],
          [-15, -1],
          [-15, -5],
          [-20, -5],
          [-20, -1],
        ],
      ],
    });
  });
});

describe('bboxToBounds', () => {
  it('should convert ENVELOPE string to LngLatBounds', () => {
    const bbox = 'ENVELOPE(-10,-5,5,0)';
    const bounds = bboxToBounds(bbox);
    expect(bounds).toEqual(new LngLatBounds([-10, 0], [-5, 5]));
  });

  it('should return null for invalid ENVELOPE strings', () => {
    const invalidBbox = 'INVALID(-10,-5,5,0)';
    const bounds = bboxToBounds(invalidBbox);
    expect(bounds).toBeNull();
  });
});

describe('boundsToGeoJSON', () => {
  it('should convert LngLatBounds to GeoJSON Polygon', () => {
    const bounds = new LngLatBounds([-10, 0], [-5, 5]);
    const geojson = boundsToGeoJSON(bounds);
    expect(geojson).toEqual({
      type: 'Polygon',
      coordinates: [
        [
          [-10, 0],
          [-5, 0],
          [-5, 5],
          [-10, 5],
          [-10, 0],
        ],
      ],
    });
  });
});
