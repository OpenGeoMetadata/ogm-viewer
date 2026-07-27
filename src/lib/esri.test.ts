import { describe, it, expect, vi, afterEach } from '@stencil/vitest';
import { LngLatBounds } from 'maplibre-gl';

import {
  esriExtentToBounds,
  esriExtentToSourceBounds,
  esriGeometryToGeoJSON,
  esriIdentifyResultsToFeatures,
  esriQueryFeaturesToGeoJSON,
  fetchEsriJson,
  hasCapability,
  isGeographic,
  isWebMercator,
  splitEsriLayerUrl,
  throwOnEsriError,
} from './esri';
import { HttpError } from './errors';

// A ring drawn clockwise, which is how Esri writes the outline of a polygon
const OUTLINE = [
  [0, 0],
  [0, 10],
  [10, 10],
  [10, 0],
  [0, 0],
];

// The same shape drawn counter-clockwise, which is how Esri writes a hole
const HOLE = [
  [2, 2],
  [4, 2],
  [4, 4],
  [2, 4],
  [2, 2],
];

describe('isWebMercator', () => {
  it('accepts the EPSG code and the ArcGIS well-known IDs for the same grid', () => {
    expect(isWebMercator({ wkid: 3857 })).toBe(true);
    expect(isWebMercator({ wkid: 102100 })).toBe(true);
    expect(isWebMercator({ wkid: 102113 })).toBe(true);
  });

  it('prefers latestWkid, which is where ArcGIS puts the EPSG code', () => {
    expect(isWebMercator({ wkid: 102100, latestWkid: 3857 })).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isWebMercator({ wkid: 4326 })).toBe(false);
    expect(isWebMercator({ wkid: 26915 })).toBe(false);
    expect(isWebMercator(undefined)).toBe(false);
  });
});

describe('isGeographic', () => {
  it('accepts degrees on WGS84 and on the NAD83 datums close enough to it', () => {
    expect(isGeographic({ wkid: 4326 })).toBe(true);
    expect(isGeographic({ wkid: 4269 })).toBe(true);
  });

  it('rejects projected coordinate systems', () => {
    expect(isGeographic({ wkid: 3857 })).toBe(false);
    expect(isGeographic(undefined)).toBe(false);
  });
});

describe('esriExtentToBounds', () => {
  it('converts an extent in Web Mercator meters to degrees', () => {
    const bounds = esriExtentToBounds({
      xmin: -10018754.17,
      ymin: 5009377.09,
      xmax: -8905559.26,
      ymax: 6446275.84,
      spatialReference: { wkid: 102100, latestWkid: 3857 },
    }) as LngLatBounds;

    expect(bounds.getWest()).toBeCloseTo(-90, 4);
    expect(bounds.getSouth()).toBeCloseTo(40.9799, 3);
    expect(bounds.getEast()).toBeCloseTo(-80, 4);
    expect(bounds.getNorth()).toBeCloseTo(50, 3);
  });

  it('passes a geographic extent through', () => {
    const bounds = esriExtentToBounds({ xmin: -91.5, ymin: 36.9, xmax: -87.4, ymax: 42.5, spatialReference: { wkid: 4326 } }) as LngLatBounds;

    expect(bounds.getWest()).toEqual(-91.5);
    expect(bounds.getNorth()).toEqual(42.5);
  });

  it('clamps an extent that reaches past the poles, which a coordinate cannot express', () => {
    // Web Mercator stops just short of the poles, but services round their extents outward past it
    const bounds = esriExtentToBounds({ xmin: -20037508, ymin: -30000000, xmax: 20037508, ymax: 30000000, spatialReference: { wkid: 3857 } }) as LngLatBounds;

    expect(bounds.getSouth()).toBeGreaterThanOrEqual(-90);
    expect(bounds.getNorth()).toBeLessThanOrEqual(90);
  });

  it('gives up on a projection it cannot convert, rather than reading the numbers as degrees', () => {
    // UTM zone 15N, whose eastings would otherwise look like plausible longitudes
    expect(esriExtentToBounds({ xmin: 189000, ymin: 4800000, xmax: 761000, ymax: 5472000, spatialReference: { wkid: 26915 } })).toBeUndefined();
  });

  it('gives up on an extent that is empty or incomplete', () => {
    expect(esriExtentToBounds(undefined)).toBeUndefined();
    expect(esriExtentToBounds({ xmin: 10, ymin: 0, xmax: -10, ymax: 10, spatialReference: { wkid: 4326 } })).toBeUndefined();
    expect(esriExtentToBounds({ xmin: NaN, ymin: 0, xmax: 10, ymax: 10, spatialReference: { wkid: 4326 } })).toBeUndefined();
  });
});

describe('esriExtentToSourceBounds', () => {
  it('flattens the bounds into the west,south,east,north array a MapLibre source takes', () => {
    const bounds = esriExtentToSourceBounds({ xmin: -91.5, ymin: 36.9, xmax: -87.4, ymax: 42.5, spatialReference: { wkid: 4326 } });
    expect(bounds).toEqual([-91.5, 36.9, -87.4, 42.5]);
  });

  it('is undefined when the extent could not be converted', () => {
    expect(esriExtentToSourceBounds({ xmin: 189000, ymin: 4800000, xmax: 761000, ymax: 5472000, spatialReference: { wkid: 26915 } })).toBeUndefined();
  });
});

describe('esriGeometryToGeoJSON', () => {
  it('reads a point', () => {
    expect(esriGeometryToGeoJSON({ x: -93.6, y: 41.9 })).toEqual({ type: 'Point', coordinates: [-93.6, 41.9] });
  });

  it('reads a multipoint', () => {
    expect(
      esriGeometryToGeoJSON({
        points: [
          [0, 0],
          [1, 1],
        ],
      }),
    ).toEqual({
      type: 'MultiPoint',
      coordinates: [
        [0, 0],
        [1, 1],
      ],
    });
  });

  it('reads a single path as a LineString and several as a MultiLineString', () => {
    const path = [
      [0, 0],
      [1, 1],
    ];
    expect(esriGeometryToGeoJSON({ paths: [path] })).toEqual({ type: 'LineString', coordinates: path });
    expect(esriGeometryToGeoJSON({ paths: [path, path] })).toEqual({ type: 'MultiLineString', coordinates: [path, path] });
  });

  it('reads a single ring as a Polygon', () => {
    expect(esriGeometryToGeoJSON({ rings: [OUTLINE] })).toEqual({ type: 'Polygon', coordinates: [OUTLINE] });
  });

  it('nests a counter-clockwise ring inside the outline before it as a hole', () => {
    expect(esriGeometryToGeoJSON({ rings: [OUTLINE, HOLE] })).toEqual({ type: 'Polygon', coordinates: [OUTLINE, HOLE] });
  });

  it('starts a new polygon at each clockwise ring', () => {
    const second = OUTLINE.map(([x, y]) => [x + 100, y]);
    expect(esriGeometryToGeoJSON({ rings: [OUTLINE, HOLE, second] })).toEqual({
      type: 'MultiPolygon',
      coordinates: [[OUTLINE, HOLE], [second]],
    });
  });

  it('keeps a leading counter-clockwise ring rather than dropping it', () => {
    // Not every service is careful about winding, and a shape with no outline draws nothing
    expect(esriGeometryToGeoJSON({ rings: [HOLE] })).toEqual({ type: 'Polygon', coordinates: [HOLE] });
  });

  it('has no geometry for an empty or missing one', () => {
    expect(esriGeometryToGeoJSON(null)).toBeNull();
    expect(esriGeometryToGeoJSON(undefined)).toBeNull();
    expect(esriGeometryToGeoJSON({})).toBeNull();
    expect(esriGeometryToGeoJSON({ rings: [] })).toBeNull();
  });
});

describe('esriIdentifyResultsToFeatures', () => {
  it('keeps the attributes as the properties and numbers the features', () => {
    const features = esriIdentifyResultsToFeatures([
      { layerName: 'Boundaries', attributes: { EPISODE: 'Wisconsin' }, geometry: { rings: [OUTLINE] } },
      { layerName: 'Boundaries', attributes: { EPISODE: 'Illinois' }, geometry: null },
    ]);

    expect(features).toHaveLength(2);
    expect(features[0].id).toEqual(0);
    expect(features[0].properties).toEqual({ EPISODE: 'Wisconsin' });
    expect(features[0].geometry).toEqual({ type: 'Polygon', coordinates: [OUTLINE] });

    // A result can arrive with attributes and no geometry, which the map has nothing to draw for
    expect(features[1].id).toEqual(1);
    expect(features[1].geometry).toBeNull();
  });

  it('has no features for an empty or missing result list', () => {
    expect(esriIdentifyResultsToFeatures([])).toEqual([]);
    expect(esriIdentifyResultsToFeatures(undefined)).toEqual([]);
  });
});

describe('esriQueryFeaturesToGeoJSON', () => {
  it('takes the feature ID from the layer own ID field', () => {
    const features = esriQueryFeaturesToGeoJSON([{ attributes: { FID: 7, Species: 'ULPU' }, geometry: { x: -82.4, y: 35.6 } }], 'FID');

    expect(features[0].id).toEqual(7);
    expect(features[0].properties).toEqual({ FID: 7, Species: 'ULPU' });
    expect(features[0].geometry).toEqual({ type: 'Point', coordinates: [-82.4, 35.6] });
  });

  it('falls back to numbering the features when the ID field is missing', () => {
    const features = esriQueryFeaturesToGeoJSON([{ attributes: { Species: 'ULPU' } }, { attributes: { Species: 'ACRU' } }]);
    expect(features.map(feature => feature.id)).toEqual([0, 1]);
  });
});

describe('hasCapability', () => {
  it('matches a whole capability, not part of one', () => {
    const metadata = { capabilities: 'Map, Query,Data' };
    expect(hasCapability(metadata, 'Query')).toBe(true);
    expect(hasCapability(metadata, 'Map')).toBe(true);
    expect(hasCapability(metadata, 'TilesOnly')).toBe(false);

    // 'Map' shouldn't be found inside 'TilesOnly''s neighbours, nor 'Data' inside 'Metadata'
    expect(hasCapability({ capabilities: 'Metadata' }, 'Data')).toBe(false);
  });

  it('is false when the service lists no capabilities', () => {
    expect(hasCapability({}, 'Query')).toBe(false);
  });
});

describe('splitEsriLayerUrl', () => {
  it('splits a trailing layer ID off the service URL', () => {
    expect(splitEsriLayerUrl('https://example.org/arcgis/rest/services/Geology/MapServer/0')).toEqual({
      serviceUrl: 'https://example.org/arcgis/rest/services/Geology/MapServer',
      layerId: '0',
    });
  });

  it('ignores a trailing slash', () => {
    expect(splitEsriLayerUrl('https://example.org/arcgis/rest/services/Geology/MapServer/12/')).toEqual({
      serviceUrl: 'https://example.org/arcgis/rest/services/Geology/MapServer',
      layerId: '12',
    });
    expect(splitEsriLayerUrl('https://example.org/arcgis/rest/services/Geology/MapServer/')).toEqual({
      serviceUrl: 'https://example.org/arcgis/rest/services/Geology/MapServer',
    });
  });

  it('leaves a URL that names no layer alone', () => {
    expect(splitEsriLayerUrl('https://example.org/arcgis/rest/services/Imagery/ImageServer')).toEqual({
      serviceUrl: 'https://example.org/arcgis/rest/services/Imagery/ImageServer',
    });
  });
});

describe('throwOnEsriError', () => {
  it('passes a successful response through', () => {
    const body = { name: 'Glacial_Boundaries' };
    expect(throwOnEsriError(body, 'https://example.org/MapServer')).toBe(body);
  });

  it('raises an ArcGIS error object as the HTTP error it should have been', () => {
    const body = { error: { code: 400, message: 'Invalid URL', details: ['Invalid URL'] } };

    expect(() => throwOnEsriError(body, 'https://example.org/MapServer')).toThrow(HttpError);
    try {
      throwOnEsriError(body, 'https://example.org/MapServer');
    } catch (error) {
      expect((error as HttpError).status).toEqual(400);
    }
  });
});

describe('fetchEsriJson', () => {
  afterEach(() => vi.unstubAllGlobals());

  const stubFetch = (body: unknown, ok = true, status = 200) => {
    const fetchMock = vi.fn().mockResolvedValue({ ok, status, statusText: '', json: async () => body });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  it('asks for JSON and merges in any extra params', async () => {
    const fetchMock = stubFetch({ name: 'Trees' });
    await fetchEsriJson('https://example.org/FeatureServer/0', { where: '1=1' });

    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get('f')).toEqual('json');
    expect(url.searchParams.get('where')).toEqual('1=1');
  });

  it('lets a caller ask for another format, e.g. GeoJSON', async () => {
    const fetchMock = stubFetch({ type: 'FeatureCollection', features: [] });
    await fetchEsriJson('https://example.org/FeatureServer/0/query', { f: 'geojson' });

    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('f')).toEqual('geojson');
  });

  it('raises an error ArcGIS reported with a successful HTTP status', async () => {
    stubFetch({ error: { code: 498, message: 'Invalid token' } });
    await expect(fetchEsriJson('https://example.org/MapServer')).rejects.toThrow(HttpError);
  });

  it('raises a failing HTTP status', async () => {
    stubFetch({}, false, 404);
    await expect(fetchEsriJson('https://example.org/MapServer')).rejects.toThrow(HttpError);
  });
});
