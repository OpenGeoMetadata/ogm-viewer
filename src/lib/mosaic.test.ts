import { describe, it, expect } from '@stencil/vitest';

import { mosaicMinZoom, mosaicSheets, offersMosaic, type MosaicSheet } from './mosaic';

const square = (x: number, y: number, size: number): GeoJSON.Polygon => ({
  type: 'Polygon',
  coordinates: [
    [
      [x, y],
      [x + size, y],
      [x + size, y + size],
      [x, y + size],
      [x, y],
    ],
  ],
});

type Sheet = GeoJSON.Feature<GeoJSON.Geometry | null>;

const sheet = (geometry: GeoJSON.Geometry | null, properties: Record<string, unknown>): Sheet => ({ type: 'Feature', geometry, properties });

const indexMap = (...features: Sheet[]): GeoJSON.FeatureCollection<GeoJSON.Geometry | null> => ({ type: 'FeatureCollection', features });

const tif = (name: string) => `https://example.com/sheets/${name}.tif`;

describe('mosaicSheets', () => {
  it('takes each sheet that links a GeoTIFF, with the box around its outline', () => {
    const sheets = mosaicSheets(indexMap(sheet(square(-106, 39, 1), { download: tif('n40w106') }), sheet(square(-105, 39, 1), { download: tif('n40w105') })));

    expect(sheets).toEqual([
      { id: tif('n40w106'), url: tif('n40w106'), bbox: [-106, 39, -105, 40] },
      { id: tif('n40w105'), url: tif('n40w105'), bbox: [-105, 39, -104, 40] },
    ]);
  });

  it('reads either spelling of the extension, in any case', () => {
    const sheets = mosaicSheets(
      indexMap(sheet(square(0, 0, 1), { download: 'https://example.com/A.TIFF' }), sheet(square(1, 0, 1), { download: 'https://example.com/b.Tif?x=1' })),
    );

    expect(sheets.map(({ url }) => url)).toEqual(['https://example.com/A.TIFF', 'https://example.com/b.Tif?x=1']);
  });

  it('leaves out sheets it could not draw', () => {
    const sheets = mosaicSheets(
      indexMap(
        sheet(square(0, 0, 1), { download: tif('unavailable'), available: false }),
        sheet(square(1, 0, 1), { download: 'https://example.com/sheet.zip' }),
        sheet(square(2, 0, 1), { download: 'ftp://example.com/sheet.tif' }),
        sheet(square(3, 0, 1), { download: '0' }),
        sheet(null, { download: tif('nowhere') }),
        sheet({ type: 'Point', coordinates: [4, 0] }, { download: tif('point') }),
        sheet(square(5, 0, 1), {}),
        sheet(square(6, 0, 1), { download: tif('kept'), available: true }),
      ),
    );

    expect(sheets.map(({ url }) => url)).toEqual([tif('kept')]);
  });

  it('leaves out a sheet that straddles the antimeridian', () => {
    const straddling: GeoJSON.Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [179.5, 51],
          [-179.5, 51],
          [-179.5, 52],
          [179.5, 52],
          [179.5, 51],
        ],
      ],
    };

    expect(mosaicSheets(indexMap(sheet(straddling, { download: tif('aleutians') })))).toEqual([]);
  });

  it('takes the box around every part of a multipolygon', () => {
    const parts: GeoJSON.MultiPolygon = { type: 'MultiPolygon', coordinates: [square(0, 0, 1).coordinates, square(3, 2, 1).coordinates] };

    expect(mosaicSheets(indexMap(sheet(parts, { download: tif('islands') })))[0].bbox).toEqual([0, 0, 4, 3]);
  });

  it('keeps the last listed of the sheets sharing an outline, in the place of the first', () => {
    const sheets = mosaicSheets(
      indexMap(
        sheet(square(0, 0, 1), { download: tif('estes-park-1961') }),
        sheet(square(1, 0, 1), { download: tif('longs-peak-1961') }),
        sheet(square(0, 0, 1), { download: tif('estes-park-1961-printed-1988') }),
      ),
    );

    expect(sheets.map(({ url }) => url)).toEqual([tif('estes-park-1961-printed-1988'), tif('longs-peak-1961')]);
  });

  it('finds nothing in a document that is not a feature collection', () => {
    expect(mosaicSheets(undefined)).toEqual([]);
    expect(mosaicSheets({ type: 'Feature' })).toEqual([]);
  });
});

describe('offersMosaic', () => {
  it('offers one when most downloads are GeoTIFFs', () => {
    expect(
      offersMosaic(
        indexMap(sheet(square(0, 0, 1), { download: tif('a') }), sheet(square(1, 0, 1), { download: tif('b') }), sheet(square(2, 0, 1), { download: 'https://example.com/c.zip' })),
      ),
    ).toBe(true);
  });

  it('offers none when most downloads are something else', () => {
    expect(
      offersMosaic(
        indexMap(
          sheet(square(0, 0, 1), { download: tif('a') }),
          sheet(square(1, 0, 1), { download: tif('b') }),
          sheet(square(2, 0, 1), { download: 'https://example.com/c.zip' }),
          sheet(square(3, 0, 1), { download: 'https://example.com/d.zip' }),
          sheet(square(4, 0, 1), { download: 'https://example.com/e.zip' }),
        ),
      ),
    ).toBe(false);
  });

  it('counts every edition of a sheet towards the share', () => {
    const editions = [1, 2, 3].flatMap(year => [sheet(square(0, 0, 1), { download: tif(`a-${year}`) }), sheet(square(1, 0, 1), { download: tif(`b-${year}`) })]);

    expect(offersMosaic(indexMap(...editions, sheet(square(2, 0, 1), { download: 'https://example.com/c.zip' })))).toBe(true);
  });

  it('offers none for a single outline, however many editions fill it', () => {
    expect(offersMosaic(indexMap(sheet(square(0, 0, 1), { download: tif('a-1961') }), sheet(square(0, 0, 1), { download: tif('a-1988') })))).toBe(false);
  });

  it('offers none for an index map with no downloads', () => {
    expect(offersMosaic(indexMap(sheet(square(0, 0, 1), { iiifUrl: 'https://example.com/manifest' })))).toBe(false);
  });
});

describe('mosaicMinZoom', () => {
  const grid = (size: number, count: number): MosaicSheet[] =>
    Array.from({ length: count }, (_, i) => ({ id: `${i}`, url: `${i}`, bbox: [-106 + i * size, 39, -106 + (i + 1) * size, 39 + size] }));

  it('waits for zoom 5 for 3DEP’s one-degree tiles', () => {
    expect(mosaicMinZoom(grid(1, 9))).toEqual(5);
  });

  it('waits for zoom 8 for 7.5-minute quads', () => {
    expect(mosaicMinZoom(grid(0.125, 9))).toEqual(8);
  });

  it('is a whole zoom, which is all deck.gl will honour', () => {
    expect(Number.isInteger(mosaicMinZoom(grid(0.3, 5)))).toBe(true);
  });

  it('goes by the typical sheet rather than the largest', () => {
    const quads = grid(0.125, 9);
    const overview: MosaicSheet = { id: 'overview', url: 'overview', bbox: [-110, 35, -100, 45] };

    expect(mosaicMinZoom([...quads, overview])).toEqual(8);
  });

  it('draws at any zoom when there are no sheets, or they cover the world', () => {
    expect(mosaicMinZoom([])).toEqual(0);
    expect(mosaicMinZoom([{ id: 'world', url: 'world', bbox: [-180, -85, 180, 85] }])).toEqual(0);
  });
});
