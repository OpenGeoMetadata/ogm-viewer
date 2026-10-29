import { describe, it, expect } from '@stencil/vitest';
import type { MapGeoJSONFeature } from 'maplibre-gl';

import { LABEL_POINT, labelMinZoom, labelPoint, labelSize, unmarkLabelPoints, withLabelPoints } from './labels';

const square = (x: number, y: number, size: number) => [
  [x, y],
  [x + size, y],
  [x + size, y + size],
  [x, y + size],
  [x, y],
];

const inside = ([px, py]: GeoJSON.Position, ring: GeoJSON.Position[]) => {
  let crossings = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) crossings++;
  }
  return crossings % 2 === 1;
};

describe('labelPoint', () => {
  it('labels a MultiPolygon once, inside its largest part', () => {
    const mainland = square(0, 0, 10);
    const point = labelPoint({ type: 'MultiPolygon', coordinates: [[square(11, 11, 1)], [mainland], [square(-3, -3, 2)]] });

    expect(point).toBeDefined();
    expect(inside(point!, mainland)).toBe(true);
  });

  it('stays inside a shape whose centroid is outside it', () => {
    const c = [
      [0, 0],
      [10, 0],
      [10, 2],
      [2, 2],
      [2, 8],
      [10, 8],
      [10, 10],
      [0, 10],
      [0, 0],
    ];
    const point = labelPoint({ type: 'Polygon', coordinates: [c] });

    expect(inside(point!, c)).toBe(true);
  });

  it('keeps out of a hole', () => {
    const hole = square(3, 3, 4);
    const point = labelPoint({ type: 'Polygon', coordinates: [square(0, 0, 10), hole] });

    expect(inside(point!, square(0, 0, 10))).toBe(true);
    expect(inside(point!, hole)).toBe(false);
  });

  it('finds the polygons a collection holds', () => {
    const point = labelPoint({
      type: 'GeometryCollection',
      geometries: [
        { type: 'Point', coordinates: [50, 50] },
        { type: 'Polygon', coordinates: [square(0, 0, 10)] },
      ],
    });

    expect(inside(point!, square(0, 0, 10))).toBe(true);
  });

  it('has nothing to offer a feature with no polygon in it', () => {
    expect(labelPoint({ type: 'Point', coordinates: [1, 2] })).toBeUndefined();
    expect(
      labelPoint({
        type: 'LineString',
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      }),
    ).toBeUndefined();
    expect(labelPoint(null)).toBeUndefined();
  });

  it('skips a ring too short to close around anything', () => {
    expect(
      labelPoint({
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 1],
            [0, 0],
          ],
        ],
      }),
    ).toBeUndefined();
  });
});

describe('withLabelPoints', () => {
  const sheets = (): GeoJSON.FeatureCollection => ({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: 'cugir007741.1',
        geometry: { type: 'MultiPolygon', coordinates: [[square(0, 0, 10)], [square(11, 11, 1)]] },
        properties: { label: 'SF 20', available: true },
      },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [30, 2] }, properties: { label: 'Benchmark' } },
      { type: 'Feature', geometry: { type: 'Polygon', coordinates: [square(20, 0, 4)] }, properties: null },
    ],
  });

  it('numbers every feature by its position, as generateId did, over any id it came with', () => {
    const { features } = withLabelPoints(sheets());

    expect(features.slice(0, 3).map(feature => feature.id)).toEqual([0, 1, 2]);
  });

  it('follows the features with one label point per polygon feature, carrying its id and properties', () => {
    const { features } = withLabelPoints(sheets());
    const points = features.slice(3);

    expect(points.map(point => [point.id, point.geometry.type, point.properties])).toEqual([
      [0, 'Point', { label: 'SF 20', available: true, [LABEL_POINT]: true }],
      [2, 'Point', { [LABEL_POINT]: true }],
    ]);
  });

  it('leaves the document it was given as it was', () => {
    const document = sheets();
    withLabelPoints(document);

    expect(document).toEqual(sheets());
  });

  it('answers the same document with the same labelled one, rather than placing its labels again', () => {
    const document = sheets();

    expect(withLabelPoints(document)).toBe(withLabelPoints(document));
  });

  it('reads a lone feature or a bare geometry as a document of one, numbered 0', () => {
    const polygon: GeoJSON.Polygon = { type: 'Polygon', coordinates: [square(0, 0, 10)] };

    expect(withLabelPoints({ type: 'Feature', geometry: polygon, properties: { label: 'one' } }).features.map(feature => feature.id)).toEqual([0, 0]);
    expect(withLabelPoints(polygon).features.map(feature => [feature.id, feature.geometry.type])).toEqual([
      [0, 'Polygon'],
      [0, 'Point'],
    ]);
  });
});

class RenderedFeature {
  type = 'Feature' as const;
  _geometry: GeoJSON.Geometry = { type: 'Point', coordinates: [5, 5] };

  constructor(
    public id: number,
    public properties: Record<string, unknown>,
    public source = 'sheets-geojson',
  ) {}

  get geometry() {
    return this._geometry;
  }
}

const rendered = (id: number, properties: Record<string, unknown>) => new RenderedFeature(id, properties) as unknown as MapGeoJSONFeature;

describe('unmarkLabelPoints', () => {
  it('drops the marker from a label point, keeping what names it and where it is', () => {
    const label = rendered(4, { label: 'SF 20', [LABEL_POINT]: true });

    const [unmarked] = unmarkLabelPoints([label]);

    expect(unmarked.properties).toEqual({ label: 'SF 20' });
    expect([unmarked.source, unmarked.id]).toEqual(['sheets-geojson', 4]);
    expect(unmarked.geometry).toEqual({ type: 'Point', coordinates: [5, 5] });
  });

  it('writes to a copy, not to the feature MapLibre handed over', () => {
    const label = rendered(4, { label: 'SF 20', [LABEL_POINT]: true });

    unmarkLabelPoints([label]);

    expect(label.properties).toEqual({ label: 'SF 20', [LABEL_POINT]: true });
  });

  it('hands every other feature back as it was', () => {
    const polygon = rendered(4, { label: 'SF 20' });

    expect(unmarkLabelPoints([polygon])[0]).toBe(polygon);
  });
});

describe('labelSize', () => {
  it('sets a short label on one line', () => {
    expect(labelSize('n40w106')).toEqual([3.5, 1.2]);
  });

  it('wraps a label past ten ems into balanced lines, as MapLibre does', () => {
    const [width, height] = labelSize('Shadow Mountain 1995 (printed 1998)');

    expect(width).toBeCloseTo(8.75);
    expect(height).toBeCloseTo(2.4);
  });

  it('keeps a long label with nowhere to break on one line', () => {
    expect(labelSize('n0450e1510n0450e1510n0450e1510')).toEqual([15, 1.2]);
  });

  it('gives CJK glyphs a full em, and breaks between them', () => {
    expect(labelSize('蕪湖18. 南陵縣')).toEqual([7, 1.2]);
    expect(labelSize('南陵縣南陵縣南陵縣南陵縣')).toEqual([6, 2.4]);
  });
});

describe('labelMinZoom', () => {
  const sheets = (size: number, properties: GeoJSON.GeoJsonProperties[]): GeoJSON.FeatureCollection => ({
    type: 'FeatureCollection',
    features: properties.map((props, i) => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [square(-106 + i * size, 39, size)] }, properties: props })),
  });
  const labelled = (size: number, label: string, count = 9) =>
    sheets(
      size,
      Array.from({ length: count }, () => ({ label })),
    );

  it('starts 3DEP’s one-degree tiles near zoom 5, alongside their mosaic', () => {
    expect(labelMinZoom(labelled(1, 'n40w106'), 14)).toBeCloseTo(5.1, 1);
  });

  it('waits longer for longer labels on sheets of the same size', () => {
    expect(labelMinZoom(labelled(0.125, 'Shadow Mountain 1995 (printed 1998)'), 14)).toBeGreaterThan(labelMinZoom(labelled(0.125, 'Palo Alto'), 14));
  });

  it('waits a zoom longer for text twice the size', () => {
    const quads = labelled(0.125, 'Palo Alto');

    expect(labelMinZoom(quads, 28) - labelMinZoom(quads, 14)).toBeCloseTo(1);
  });

  it('waits for a short sheet to be tall enough for its label', () => {
    const strip: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [0, 0],
                [10, 0],
                [10, 0.01],
                [0, 0.01],
                [0, 0],
              ],
            ],
          },
          properties: { label: 'A' },
        },
      ],
    };

    expect(labelMinZoom(strip, 14)).toBeGreaterThan(labelMinZoom(labelled(10, 'A', 1), 14) + 5);
  });

  it('goes by the typical sheet rather than the largest', () => {
    const quads = labelled(0.125, 'Palo Alto');
    const overview: GeoJSON.Feature = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [square(-110, 35, 10)] }, properties: { label: 'Overview' } };

    expect(labelMinZoom({ ...quads, features: [...quads.features, overview] }, 14)).toEqual(labelMinZoom(quads, 14));
  });

  it('sizes a sheet’s id when it has no label, as the label layer shows', () => {
    expect(
      labelMinZoom(
        sheets(
          1,
          Array.from({ length: 3 }, () => ({ id: 'n40w106' })),
        ),
        14,
      ),
    ).toEqual(labelMinZoom(labelled(1, 'n40w106', 3), 14));
  });

  it('labels at any zoom when there is nothing to size a label by', () => {
    expect(labelMinZoom({ type: 'FeatureCollection', features: [] }, 14)).toEqual(0);
    expect(labelMinZoom(sheets(1, [{}, { label: '' }, null]), 14)).toEqual(0);
    expect(labelMinZoom({ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { label: 'Benchmark' } }, 14)).toEqual(0);
  });

  it('stays within the zooms a MapLibre layer accepts', () => {
    expect(labelMinZoom(labelled(1e-6, 'Shadow Mountain 1995 (printed 1998)', 1), 14)).toEqual(24);
  });
});
