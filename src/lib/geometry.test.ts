import { describe, it, expect, vi } from '@stencil/vitest';
import { LngLatBounds } from 'maplibre-gl';
import { bboxToBounds, boundsToGeoJSON, geomToGeoJSON, lngLatToMercator, mercatorBbox, mercatorGeomToLngLat, mercatorToLngLat, pixelWindowCenter } from './geometry';

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

  // The whole path a record's bounding box takes: WKT parsing fails on ENVELOPE, so it is read as a
  // box and squared back off into a ring. Twenty degrees of the Pacific rather than the 340 of
  // everywhere else.
  it('should convert an ENVELOPE that crosses the antimeridian to GeoJSON', () => {
    const geojson = geomToGeoJSON('ENVELOPE(170,-170,10,-10)');
    expect(geojson).toEqual({
      type: 'Polygon',
      coordinates: [
        [
          [170, -10],
          [190, -10],
          [190, 10],
          [170, 10],
          [170, -10],
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

  // A box that crosses the antimeridian names its west edge east of its east edge, which is how both
  // Solr's ENVELOPE syntax and RFC 7946 section 5.2 say to write one. Carried onward past 180 so that
  // the box stays in one piece: read as it is written, -170 would put the camera on the 340 degrees
  // of the world the record doesn't cover.
  it('should carry the east edge past 180 for a box that crosses the antimeridian', () => {
    const bounds = bboxToBounds('ENVELOPE(170,-170,10,-10)');
    expect(bounds).toEqual(new LngLatBounds([170, -10], [190, 10]));
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

  // Each vertex is projected on its own, so a ring whose east edge reads as the smaller number is
  // drawn the long way round: across the rest of the world rather than across the date line. Every
  // corner a caller may hand us has already been carried past 180 by bboxToBounds, but one built
  // from a box by hand has not, so the ring is squared off from the edges rather than the corners.
  it('should draw a box that crosses the antimeridian the short way round', () => {
    const geojson = boundsToGeoJSON(new LngLatBounds([170, -10], [-170, 10]));
    expect(geojson).toEqual({
      type: 'Polygon',
      coordinates: [
        [
          [170, -10],
          [190, -10],
          [190, 10],
          [170, 10],
          [170, -10],
        ],
      ],
    });
  });
});

describe('lngLatToMercator', () => {
  it('should put the null island at the origin', () => {
    expect(lngLatToMercator([0, 0])).toEqual([0, 0]);
  });

  it('should convert degrees to EPSG:3857 meters', () => {
    const [x, y] = lngLatToMercator([-120.99553605196368, 37.83228807647538]);
    expect(x).toBeCloseTo(-13469161.46, 1);
    expect(y).toBeCloseTo(4555760.76, 1);
  });

  it('should count north and east as positive', () => {
    const [x, y] = lngLatToMercator([120, 60]);
    expect(x).toBeGreaterThan(0);
    expect(y).toBeGreaterThan(0);
  });
});

describe('mercatorBbox', () => {
  it('should envelope the coordinates as minx,miny,maxx,maxy', () => {
    // Corners of a query window, in the arbitrary order they were unprojected in
    const bbox = mercatorBbox([
      [-120.9, 38.5],
      [-120.0, 38.5],
      [-120.0, 37.8],
      [-120.9, 37.8],
    ]);

    const [minX, minY, maxX, maxY] = bbox.split(',').map(Number);
    expect(minX).toBeLessThan(maxX);
    expect(minY).toBeLessThan(maxY);
    expect([minX, minY]).toEqual(lngLatToMercator([-120.9, 37.8]));
    expect([maxX, maxY]).toEqual(lngLatToMercator([-120.0, 38.5]));
  });
});

describe('mercatorToLngLat', () => {
  it('should place the origin at null island', () => {
    expect(mercatorToLngLat([0, 0])).toEqual([0, 0]);
  });

  it('should invert lngLatToMercator', () => {
    const [lng, lat] = mercatorToLngLat(lngLatToMercator([-120.99553605196368, 37.83228807647538]));
    expect(lng).toBeCloseTo(-120.99553605196368, 9);
    expect(lat).toBeCloseTo(37.83228807647538, 9);
  });

  it('should convert a coordinate a WMS returned in EPSG:3857 meters', () => {
    // A vertex of a Calaveras County tract, as GeoServer reported it
    const [lng, lat] = mercatorToLngLat([-13402032.01418895, 4622299.14920388]);
    expect(lng).toBeCloseTo(-120.39250196605, 6);
    expect(lat).toBeCloseTo(38.30286413751, 6);
  });
});

describe('mercatorGeomToLngLat', () => {
  it('should reproject a point', () => {
    const geometry = mercatorGeomToLngLat({ type: 'Point', coordinates: lngLatToMercator([-120.5, 38.2]) });
    expect(geometry.type).toEqual('Point');
    expect((geometry as GeoJSON.Point).coordinates[0]).toBeCloseTo(-120.5, 9);
    expect((geometry as GeoJSON.Point).coordinates[1]).toBeCloseTo(38.2, 9);
  });

  it('should reproject every ring of a nested geometry', () => {
    const ring: [number, number][] = [
      [-120.9, 38.5],
      [-120.0, 38.5],
      [-120.0, 37.8],
      [-120.9, 38.5],
    ];
    const geometry = mercatorGeomToLngLat({
      type: 'MultiPolygon',
      coordinates: [[ring.map(lngLatToMercator)]],
    }) as GeoJSON.MultiPolygon;

    expect(geometry.type).toEqual('MultiPolygon');
    geometry.coordinates[0][0].forEach(([lng, lat], index) => {
      expect(lng).toBeCloseTo(ring[index][0], 9);
      expect(lat).toBeCloseTo(ring[index][1], 9);
    });
  });

  it('should reproject the members of a geometry collection', () => {
    const geometry = mercatorGeomToLngLat({
      type: 'GeometryCollection',
      geometries: [
        { type: 'Point', coordinates: [0, 0] },
        { type: 'LineString', coordinates: [lngLatToMercator([-120.5, 38.2]), lngLatToMercator([-120.4, 38.3])] },
      ],
    }) as GeoJSON.GeometryCollection;

    expect(geometry.geometries).toHaveLength(2);
    expect((geometry.geometries[0] as GeoJSON.Point).coordinates).toEqual([0, 0]);
    expect((geometry.geometries[1] as GeoJSON.LineString).coordinates[1][0]).toBeCloseTo(-120.4, 9);
  });

  it('should leave the original geometry untouched', () => {
    const original: GeoJSON.Point = { type: 'Point', coordinates: [-13402032.01418895, 4622299.14920388] };
    mercatorGeomToLngLat(original);
    expect(original.coordinates).toEqual([-13402032.01418895, 4622299.14920388]);
  });
});

describe('pixelWindowCenter', () => {
  // A 51x51 window spanning 510 meters, so each pixel is ten meters across
  const window = { bbox: '-10000,0,-9490,510', width: 51, height: 51, x: 25, y: 25 };

  it('should find the coordinate at the middle of the named pixel', () => {
    // Pixel 25 of 51 is the middle one, so its center sits 255m in from each edge
    expect(pixelWindowCenter(window)).toEqual({ x: -9745, y: 255, resolution: 10 });
  });

  it('should count rows down from the top edge, the way a screen does', () => {
    expect(pixelWindowCenter({ ...window, y: 0 }).y).toEqual(505);
    expect(pixelWindowCenter({ ...window, y: 50 }).y).toEqual(5);
  });

  it('should count columns right from the left edge', () => {
    expect(pixelWindowCenter({ ...window, x: 0 }).x).toEqual(-9995);
    expect(pixelWindowCenter({ ...window, x: 50 }).x).toEqual(-9495);
  });

  it('should report the pixel size, which is the finest detail worth drawing back', () => {
    expect(pixelWindowCenter({ ...window, width: 255, height: 255 }).resolution).toEqual(2);
  });
});
