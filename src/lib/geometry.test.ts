import { describe, it, expect, vi } from '@stencil/vitest';
import { LngLatBounds } from 'maplibre-gl';
import { bboxToBounds, boundsToGeoJSON, geomToGeoJSON } from './geometry';

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

  it('should be undefined for invalid geometry', () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const invalidGeom = 'INVALID(-122.6764 45.5165)';
    const geojson = geomToGeoJSON(invalidGeom);
    expect(geojson).toBeUndefined();
    expect(consoleWarnSpy).toHaveBeenCalledWith('Could not parse geometry:', invalidGeom);
    consoleWarnSpy.mockRestore();
  });
});

describe('bboxToBounds', () => {
  it('should convert ENVELOPE string to LngLatBounds', () => {
    const bbox = 'ENVELOPE(-10,-5,5,0)';
    const bounds = bboxToBounds(bbox);
    expect(bounds).toEqual(new LngLatBounds([-10, 0], [-5, 5]));
  });

  it('should be undefined for invalid ENVELOPE strings', () => {
    const invalidBbox = 'INVALID(-10,-5,5,0)';
    const bounds = bboxToBounds(invalidBbox);
    expect(bounds).toBeUndefined();
  });

  it('should be undefined for ENVELOPE strings with missing groups', () => {
    const incompleteBbox = 'ENVELOPE(-10,-5,5)';
    const bounds = bboxToBounds(incompleteBbox);
    expect(bounds).toBeUndefined();
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
