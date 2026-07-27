import { describe, it, expect } from '@stencil/vitest';

import EsriTiledMapLayerResource from './esri-tiled-map-layer';
import type { EsriMetadata, EsriTileInfo } from '../esri';

const SERVICE = 'https://example.org/arcgis/rest/services/mn_landcover/MapServer';

// Half the width of the Web Mercator plane, where a standard tile pyramid hangs from
const MERCATOR_EXTENT = 20037508.342789244;

const MINNESOTA = { xmin: -10828034.63, ymin: 5378465.06, xmax: -9951610.44, ymax: 6343784.48, spatialReference: { wkid: 102100, latestWkid: 3857 } };

// The zooms of a standard pyramid: level 0 is the whole world in one tile, and each level halves it
const pyramidLods = (zooms: number[], tileSize = 256) => zooms.map(level => ({ level, resolution: (2 * MERCATOR_EXTENT) / tileSize / 2 ** level }));

const tileInfo = (overrides: Partial<EsriTileInfo> = {}, tileSize = 256): EsriTileInfo => ({
  rows: tileSize,
  cols: tileSize,
  origin: { x: -MERCATOR_EXTENT, y: MERCATOR_EXTENT },
  spatialReference: { wkid: 102100, latestWkid: 3857 },
  lods: pyramidLods([0, 1, 2, 3, 4, 5], tileSize),
  ...overrides,
});

// A cache cut on the grid MapLibre draws in
const XYZ_CACHE: EsriMetadata = {
  capabilities: 'Map,TilesOnly',
  singleFusedMapCache: true,
  spatialReference: { wkid: 102100, latestWkid: 3857 },
  fullExtent: MINNESOTA,
  tileInfo: tileInfo(),
};

// Reads a hand-built service description instead of fetching one
class TestResource extends EsriTiledMapLayerResource {
  stub: EsriMetadata = {};

  protected async getMetadata() {
    return this.stub;
  }
}

const resourceFor = (stub: EsriMetadata) => {
  const resource = new TestResource('mn-landcover', SERVICE, undefined);
  resource.stub = stub;
  return resource;
};

describe('EsriTiledMapLayerResource#getRasterSourceSpec', () => {
  it('reads a standard cache as XYZ tiles', async () => {
    const spec = await resourceFor(XYZ_CACHE).getRasterSourceSpec();

    // ArcGIS orders the tile path zoom/row/column, which puts y before x
    expect(spec.tiles).toEqual([`${SERVICE}/tile/{z}/{y}/{x}`]);
    expect(spec.scheme).toEqual('xyz');
    expect(spec.tileSize).toEqual(256);
  });

  it('takes the zoom range from the levels the cache was cut at', async () => {
    const spec = await resourceFor({ ...XYZ_CACHE, tileInfo: tileInfo({ lods: pyramidLods([2, 3, 4, 5, 6]) }) }).getRasterSourceSpec();

    expect(spec.minzoom).toEqual(2);
    expect(spec.maxzoom).toEqual(6);
  });

  it('keeps MapLibre from asking for tiles outside the cached extent', async () => {
    const spec = await resourceFor(XYZ_CACHE).getRasterSourceSpec();

    expect(spec.bounds).toHaveLength(4);
    expect((spec.bounds as number[])[0]).toBeCloseTo(-97.27, 1);
    expect((spec.bounds as number[])[3]).toBeCloseTo(49.37, 1);
  });

  it('leaves the bounds out rather than passing an undefined one MapLibre would reject', async () => {
    const unconvertible = { ...XYZ_CACHE, fullExtent: { xmin: 189000, ymin: 4800000, xmax: 761000, ymax: 5472000, spatialReference: { wkid: 26915 } } };
    const spec = await resourceFor(unconvertible).getRasterSourceSpec();

    expect(spec.tiles[0]).toContain('/tile/');
    expect('bounds' in spec).toBe(false);
  });

  it('reads a cache of larger tiles at its own tile size', async () => {
    const spec = await resourceFor({ ...XYZ_CACHE, tileInfo: tileInfo({}, 512) }).getRasterSourceSpec();
    expect(spec.tileSize).toEqual(512);
  });

  it('falls back to drawing the map on demand when the cache is on another grid', async () => {
    // A cache in a state plane projection can't be addressed by z/x/y at all
    const statePlane = {
      ...XYZ_CACHE,
      capabilities: 'Map,Query,Data',
      tileInfo: tileInfo({ spatialReference: { wkid: 26915 }, origin: { x: 189000, y: 5472000 } }),
    };
    const spec = await resourceFor(statePlane).getRasterSourceSpec();

    expect(spec.tiles[0]).toContain(`${SERVICE}/export?`);
    expect(spec.tiles[0]).toContain('&bbox={bbox-epsg-3857}');
    expect(spec.scheme).toBeUndefined();
  });

  it('falls back when the cache uses its own set of scales rather than halving the world', async () => {
    const customScales = {
      ...XYZ_CACHE,
      capabilities: 'Map,Query,Data',
      tileInfo: tileInfo({
        lods: [
          { level: 0, resolution: 100 },
          { level: 1, resolution: 50 },
        ],
      }),
    };

    expect((await resourceFor(customScales).getRasterSourceSpec()).tiles[0]).toContain('/export?');
  });

  it('falls back when the cache hangs from somewhere other than the northwest corner', async () => {
    const shifted = { ...XYZ_CACHE, capabilities: 'Map,Query,Data', tileInfo: tileInfo({ origin: { x: 0, y: 0 } }) };

    expect((await resourceFor(shifted).getRasterSourceSpec()).tiles[0]).toContain('/export?');
  });

  it('falls back when the service has no cache at all', async () => {
    const uncached = { ...XYZ_CACHE, capabilities: 'Map,Query,Data', singleFusedMapCache: false };

    expect((await resourceFor(uncached).getRasterSourceSpec()).tiles[0]).toContain('/export?');
  });

  it('gives up on a cache it cannot read from a service that can only serve tiles', async () => {
    // Nothing left to try: the grid is unreadable and the service won't redraw the map
    const tilesOnly = { ...XYZ_CACHE, capabilities: 'Map,TilesOnly', tileInfo: tileInfo({ spatialReference: { wkid: 26915 } }) };

    await expect(resourceFor(tilesOnly).getRasterSourceSpec()).rejects.toThrow(/Web Mercator/);
  });
});

describe('EsriTiledMapLayerResource#canInspect', () => {
  it('is false for the usual tiles-only cache, which holds only pictures', async () => {
    expect(await resourceFor(XYZ_CACHE).canInspect()).toBe(false);
  });

  it('is true for a cached service that still allows querying its features', async () => {
    expect(await resourceFor({ ...XYZ_CACHE, capabilities: 'Map,Query,Data' }).canInspect()).toBe(true);
  });
});

describe('EsriTiledMapLayerResource#label', () => {
  it('tells itself apart from a dynamic map layer', () => {
    expect(resourceFor(XYZ_CACHE).label()).toEqual('ArcGIS Tiled Map Layer');
  });
});
