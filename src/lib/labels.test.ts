import { describe, it, expect } from '@stencil/vitest';
import type { MapGeoJSONFeature } from 'maplibre-gl';

import { LABEL_POINT, labelPoint, unmarkLabelPoints, withLabelPoints } from './labels';

const square = (x: number, y: number, size: number) => [
  [x, y],
  [x + size, y],
  [x + size, y + size],
  [x, y + size],
  [x, y],
];

// Whether a point falls inside a ring, by counting the edges a ray from it crosses
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

  // A region wrapped around a bay, or New England: the centroid of a C is in the gap
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

  // Those label themselves, at the point or along the line
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

  // The position is what the symbol-sort-key ranks a stack's labels by, so it has to be the id
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

// A feature as queryRenderedFeatures hands one back: its coordinates live behind a getter, so a
// plain spread of one comes out with no geometry at all
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

  // The properties object is the one MapLibre's own tile cache holds
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
