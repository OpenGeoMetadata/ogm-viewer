import { describe, it, expect, vi } from '@stencil/vitest';
import { LngLatBounds } from 'maplibre-gl';
import {
  bboxToBounds,
  boundsOverlap,
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
  tileBbox3857,
  tileLngLatSpan,
  tilesCovering,
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

  it('should undo what bboxToBounds did', () => {
    expect(boundsToBbox(bboxToBounds('ENVELOPE(170,-170,10,-10)')!)).toEqual([170, -10, -170, 10]);
  });

  it('should bring an east edge carried past 180 back into range', () => {
    expect(boundsToBbox(new LngLatBounds([170, -10], [190, 10]))).toEqual([170, -10, -170, 10]);
  });

  it('should bring back both edges of a view panned clear of the range', () => {
    expect(boundsToBbox(new LngLatBounds([530, -10], [560, 10]))).toEqual([170, -10, -160, 10]);
  });

  it('should name the whole range for a view exactly as wide as the world', () => {
    expect(boundsToBbox(new LngLatBounds([-180, -85], [180, 85]))).toEqual([-180, -85, 180, 85]);
  });

  it('should name the whole range for a view wider than the world', () => {
    expect(boundsToBbox(new LngLatBounds([-400, -60], [400, 60]))).toEqual([-180, -60, 180, 60]);
  });

  it('should leave a view that reaches a pole alone', () => {
    expect(boundsToBbox(new LngLatBounds([-30, -90], [30, 90]))).toEqual([-30, -90, 30, 90]);
  });
});

describe('readBounds', () => {
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

  it('should read nothing from a box that reaches past a pole', () => {
    expect(readBounds([-30, -100, 30, 100])).toBeUndefined();
  });
});

describe('boundsOverlap', () => {
  const ARCHIVE: [[number, number], [number, number]] = [
    [-123.532115, 36.893111],
    [-121.208298, 38.864317],
  ];

  it('should find two boxes that share some ground', () => {
    expect(
      boundsOverlap(ARCHIVE, [
        [-122.5, 37.5],
        [-120, 40],
      ]),
    ).toBe(true);
  });

  it('should find a box inside another', () => {
    expect(
      boundsOverlap(ARCHIVE, [
        [-122.5, 37.5],
        [-122.4, 37.6],
      ]),
    ).toBe(true);
  });

  it('should find nothing in common with a box elsewhere in the world', () => {
    expect(
      boundsOverlap(ARCHIVE, [
        [0, 0],
        [1, 1],
      ]),
    ).toBe(false);
  });

  it('should find nothing in common with a box above or below it at the same longitudes', () => {
    expect(
      boundsOverlap(ARCHIVE, [
        [-123, 40],
        [-122, 41],
      ]),
    ).toBe(false);
    expect(
      boundsOverlap(ARCHIVE, [
        [-123, 30],
        [-122, 31],
      ]),
    ).toBe(false);
  });

  it('should count boxes that only touch as overlapping', () => {
    expect(
      boundsOverlap(ARCHIVE, [
        [-121.208298, 38],
        [-120, 39],
      ]),
    ).toBe(true);
    expect(
      boundsOverlap(ARCHIVE, [
        [-121.208298, 38.864317],
        [-121.208298, 38.864317],
      ]),
    ).toBe(true);
  });

  it('should find a box on either side of the antimeridian inside one that crosses it', () => {
    const aleutians = bboxToBounds('ENVELOPE(170.0,-170.0,54.0,50.0)')!;

    expect(
      boundsOverlap(aleutians, [
        [175, 51],
        [176, 52],
      ]),
    ).toBe(true);
    expect(
      boundsOverlap(aleutians, [
        [-175, 51],
        [-174, 52],
      ]),
    ).toBe(true);
    expect(
      boundsOverlap(
        [
          [175, 51],
          [176, 52],
        ],
        aleutians,
      ),
    ).toBe(true);
  });

  it('should find nothing in common between a box that crosses the antimeridian and one across the world from it', () => {
    expect(
      boundsOverlap(bboxToBounds('ENVELOPE(170.0,-170.0,54.0,50.0)')!, [
        [0, 51],
        [1, 52],
      ]),
    ).toBe(false);
  });

  it('should find a box written past 180 where the same place written plainly is', () => {
    expect(
      boundsOverlap(
        [
          [0.5, 0.5],
          [0.6, 0.6],
        ],
        [
          [360, 0],
          [361, 1],
        ],
      ),
    ).toBe(true);
    expect(
      boundsOverlap(
        [
          [-122.5, 37.5],
          [-122.4, 37.6],
        ],
        [
          [237.5, 37.5],
          [237.6, 37.6],
        ],
      ),
    ).toBe(true);
  });

  it('should find anything at the same latitudes inside a box that goes all the way round', () => {
    expect(
      boundsOverlap(
        [
          [-180, -85],
          [180, 85],
        ],
        ARCHIVE,
      ),
    ).toBe(true);
    expect(
      boundsOverlap(
        [
          [-200, -10],
          [200, 10],
        ],
        [
          [100, 0],
          [101, 1],
        ],
      ),
    ).toBe(true);
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
  const window = { bbox: '-10000,0,-9490,510', width: 51, height: 51, x: 25, y: 25 };

  it('should find the coordinate at the middle of the named pixel', () => {
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

  it('should count half the world as facing the camera', () => {
    const halfTheWorld = new LngLatBounds([
      [-90, -40],
      [90, 60],
    ]);

    expect(clampToHemisphere(halfTheWorld).toArray()).toEqual(halfTheWorld.toArray());
  });

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

  it('should show a whole globe when asked for the whole world', () => {
    const clamped = clampToHemisphere(WORLD);

    expect(clamped.getEast() - clamped.getWest()).toEqual(180);
    expect(clamped.getCenter().lng).toEqual(0);
  });
});

describe('tileBbox3857', () => {
  const round = (box: number[]) => box.map(Math.round);

  it('gives the whole plane for the tile the whole world is one of', () => {
    expect(round(tileBbox3857(0, 0, 0))).toEqual([-20037508, -20037508, 20037508, 20037508]);
  });

  it('hangs the grid from the northwest corner, so y counts southward', () => {
    expect(round(tileBbox3857(1, 0, 0))).toEqual([-20037508, 0, 0, 20037508]);
    expect(round(tileBbox3857(1, 1, 1))).toEqual([0, -20037508, 20037508, 0]);
  });

  it('widens every edge by the fraction of a tile it was asked for', () => {
    const plain = tileBbox3857(10, 257, 375);
    const buffered = tileBbox3857(10, 257, 375, 64 / 4096);
    const width = plain[2] - plain[0];

    [0, 1].forEach(edge => expect((plain[edge] - buffered[edge]) / width).toBeCloseTo(64 / 4096, 12));
    [2, 3].forEach(edge => expect((buffered[edge] - plain[edge]) / width).toBeCloseTo(64 / 4096, 12));
  });
});

describe('tileLngLatSpan', () => {
  it('divides the world into as many tiles as the zoom has', () => {
    expect(tileLngLatSpan(0)).toEqual(360);
    expect(tileLngLatSpan(10)).toBeCloseTo(0.3515625, 7);
  });
});

describe('tilesCovering', () => {
  it('counts one tile for the zoom that is one tile', () => {
    expect(tilesCovering(new LngLatBounds([-180, -85], [180, 85]), 0)).toBeCloseTo(1, 1);
  });

  it('counts four times as many with every zoom', () => {
    const wisconsin = new LngLatBounds([-92.99, 42.39], [-86.68, 47.1]);

    expect(tilesCovering(wisconsin, 10) / tilesCovering(wisconsin, 9)).toBeCloseTo(4, 6);
  });

  it('never counts less than one tile, however small the extent', () => {
    expect(tilesCovering(new LngLatBounds([-89.4, 43.07], [-89.4, 43.07]), 14)).toEqual(1);
  });
});
