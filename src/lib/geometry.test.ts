import { describe, it, expect, vi } from '@stencil/vitest';
import { LngLatBounds } from 'maplibre-gl';
import {
  bboxToBounds,
  boundsToBbox,
  boundsToGeoJSON,
  clampToHemisphere,
  geomToGeoJSON,
  lngLatToMercator,
  mercatorBbox,
  mercatorGeomToLngLat,
  mercatorToLngLat,
  pixelWindowCenter,
  readBounds,
  unionBounds,
  WORLD,
} from './geometry';

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

describe('boundsToBbox', () => {
  it('should convert LngLatBounds to a west, south, east, north array', () => {
    expect(boundsToBbox(new LngLatBounds([-124.41, 32.53], [-114.13, 42.01]))).toEqual([-124.41, 32.53, -114.13, 42.01]);
  });

  // The inverse of bboxToBounds, so what one takes apart the other puts back
  it('should undo what bboxToBounds did', () => {
    expect(boundsToBbox(bboxToBounds('ENVELOPE(170,-170,10,-10)')!)).toEqual([170, -10, -170, 10]);
  });

  // What bboxToBounds hands over for a box across the antimeridian, and what a camera panned onto one
  // reports: an east edge carried past 180. Named the way it has to be written rather than the way it
  // was read - see the note above unwrapEast - so the 20 degrees of the Pacific is what gets searched
  // rather than the 340 degrees of everywhere else.
  it('should bring an east edge carried past 180 back into range', () => {
    expect(boundsToBbox(new LngLatBounds([170, -10], [190, 10]))).toEqual([170, -10, -170, 10]);
  });

  // A camera's center is never wrapped, so panning east far enough leaves both edges out of range
  it('should bring back both edges of a view panned clear of the range', () => {
    expect(boundsToBbox(new LngLatBounds([530, -10], [560, 10]))).toEqual([170, -10, -160, 10]);
  });

  // Named outright rather than wrapped: MapLibre's wrap answers 180 for an edge on -180, which would
  // leave the whole world reported as a line
  it('should name the whole range for a view exactly as wide as the world', () => {
    expect(boundsToBbox(new LngLatBounds([-180, -85], [180, 85]))).toEqual([-180, -85, 180, 85]);
  });

  // Several world copies at once, which a flat map at minZoom 0 can show
  it('should name the whole range for a view wider than the world', () => {
    expect(boundsToBbox(new LngLatBounds([-400, -60], [400, 60]))).toEqual([-180, -60, 180, 60]);
  });

  // A globe with a pole facing the camera reports exactly the pole, which is a latitude Solr takes
  it('should leave a view that reaches a pole alone', () => {
    expect(boundsToBbox(new LngLatBounds([-30, -90], [30, 90]))).toEqual([-30, -90, 30, 90]);
  });
});

describe('readBounds', () => {
  // The four numbers in the order every other bbox here is written in
  it('should read a west, south, east, north list', () => {
    expect(readBounds([-124.41, 32.53, -114.13, 42.01])?.toArray()).toEqual([
      [-124.41, 32.53],
      [-114.13, 42.01],
    ]);
  });

  it('should read a list written out as a string, however it is separated', () => {
    expect(readBounds('-124.41 32.53 -114.13 42.01')?.toArray()).toEqual(readBounds('-124.41,32.53,-114.13,42.01')?.toArray());
    expect(readBounds('-124.41 32.53 -114.13 42.01')?.getWest()).toEqual(-124.41);
  });

  // The form dcat_bbox is written in, so a record's own box can be handed over as it stands
  it('should read an ENVELOPE string', () => {
    expect(readBounds('ENVELOPE(-124.41,-114.13,42.01,32.53)')?.toArray()).toEqual([
      [-124.41, 32.53],
      [-114.13, 42.01],
    ]);
  });

  it('should read anything else MapLibre reads as bounds', () => {
    const bounds = new LngLatBounds([-10, 0], [-5, 5]);
    expect(readBounds(bounds)?.toArray()).toEqual(bounds.toArray());
    expect(
      readBounds([
        [-10, 0],
        [-5, 5],
      ])?.toArray(),
    ).toEqual(bounds.toArray());
  });

  // The inverse of boundsToBbox, which is what lets an area a reader asked to search be handed back
  // to hold the map there. The east edge is carried past 180 again on the way in, so the camera frames
  // the 30 degrees of the Pacific the view covered rather than the 330 degrees of everywhere else.
  it('should undo what boundsToBbox did to a view across the antimeridian', () => {
    const view = new LngLatBounds([530, -10], [560, 10]);
    const read = readBounds(boundsToBbox(view))!;

    expect([read.getWest(), read.getSouth(), read.getEast(), read.getNorth()]).toEqual([170, -10, 200, 10]);
    expect(read.getEast() - read.getWest()).toEqual(view.getEast() - view.getWest());
  });

  it('should read nothing from a string that says something else', () => {
    expect(readBounds('POINT(-122.17 37.43)')).toBeUndefined();
    expect(readBounds('-124.41 32.53 -114.13')).toBeUndefined();
    expect(readBounds('west south east north')).toBeUndefined();
    expect(readBounds('')).toBeUndefined();
  });

  // MapLibre throws on these rather than saying so, and a camera nobody can point is worth reporting
  it('should read nothing from a box that reaches past a pole', () => {
    expect(readBounds([-30, -100, 30, 100])).toBeUndefined();
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

describe('unionBounds', () => {
  const CALIFORNIA: [[number, number], [number, number]] = [
    [-124.41, 32.53],
    [-114.13, 42.01],
  ];
  const ICELAND: [[number, number], [number, number]] = [
    [-24.55, 63.39],
    [-13.49, 66.57],
  ];

  it('should take in everywhere it is given', () => {
    expect(unionBounds([CALIFORNIA, ICELAND])!.toArray()).toEqual([
      [-124.41, 32.53],
      [-13.49, 66.57],
    ]);
  });

  // extend() writes into the box it is called on, so a union that started from the first extent
  // given would quietly grow whichever box its caller handed over first.
  it('should leave the extents it was handed alone', () => {
    const california = new LngLatBounds(CALIFORNIA);
    unionBounds([california, ICELAND]);

    expect(california.toArray()).toEqual(CALIFORNIA);
  });

  it('should have nowhere to point when no record says where it is', () => {
    expect(unionBounds([])).toBeUndefined();
    expect(unionBounds([undefined, undefined])).toBeUndefined();
  });

  it('should skip past the records it has nowhere to put', () => {
    expect(unionBounds([undefined, CALIFORNIA, undefined])!.toArray()).toEqual(CALIFORNIA);
  });

  // A box over the Bering Strait arrives with its east edge carried past 180 - see unwrapEast - and
  // has to keep it. Read as 170..-170 the union would span the 340 degrees of everywhere else.
  it('should keep a box that crosses the antimeridian on its own side of the world', () => {
    const aleutians = bboxToBounds('ENVELOPE(170.0,-170.0,54.0,50.0)')!;

    expect(unionBounds([aleutians])!.getEast()).toEqual(190);
  });
});

describe('clampToHemisphere', () => {
  it('should leave a box that already faces one camera alone', () => {
    const california = new LngLatBounds([
      [-124.41, 32.53],
      [-114.13, 42.01],
    ]);

    expect(clampToHemisphere(california).toArray()).toEqual(california.toArray());
  });

  // Half the world is what a globe shows, so a box that measures exactly that is already pointable
  it('should count half the world as facing the camera', () => {
    const halfTheWorld = new LngLatBounds([
      [-90, -40],
      [90, 60],
    ]);

    expect(clampToHemisphere(halfTheWorld).toArray()).toEqual(halfTheWorld.toArray());
  });

  // Past a hemisphere MapLibre's globe camera has nothing left to solve against - every corner it
  // tests is behind the horizon - and hands back no camera at all. Held to the half of the world
  // around the box's own middle, which is the most of it anyone can see at once.
  it('should hold the camera to the half of the world it can actually see', () => {
    const clamped = clampToHemisphere([
      [-170, -40],
      [130, 60],
    ]);

    expect(clamped.getEast() - clamped.getWest()).toEqual(180);
    expect(clamped.getCenter().lng).toBeCloseTo(-20);
  });

  it('should leave the latitudes it was given alone, there being no wider angle to mistake', () => {
    const clamped = clampToHemisphere([
      [-170, -40],
      [130, 60],
    ]);

    expect([clamped.getSouth(), clamped.getNorth()]).toEqual([-40, 60]);
  });

  // What a single record covering the whole world is pointed at: the half of it facing the camera,
  // with the rest of the record drawn round the back.
  it('should show a whole globe when asked for the whole world', () => {
    const clamped = clampToHemisphere(WORLD);

    expect(clamped.getEast() - clamped.getWest()).toEqual(180);
    expect(clamped.getCenter().lng).toEqual(0);
  });
});
