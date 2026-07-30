import { describe, it, expect, vi, afterEach } from '@stencil/vitest';

import { previewersFor, previewersForResources } from './factory';
import type Resource from '../resources/resource';
import type { ResourceKind } from '../resources/resource';

import CogPreviewer from './cog';
import EsriDynamicMapLayerPreviewer from './esri-dynamic-map-layer';
import EsriFeatureLayerPreviewer from './esri-feature-layer';
import EsriImageMapLayerPreviewer from './esri-image-map-layer';
import EsriTiledMapLayerPreviewer from './esri-tiled-map-layer';
import GeoJsonPreviewer from './geojson';
import ImagePreviewer from './image';
import OpenIndexMapPreviewer from './openindexmap';
import PMTilesRasterPreviewer from './pmtiles-raster';
import PMTilesVectorPreviewer from './pmtiles-vector';
import RasterPreviewer from './raster';
import TileJsonRasterPreviewer from './tilejson-raster';
import TileJsonVectorPreviewer from './tilejson-vector';
import WmsPreviewer from './wms';
import WmtsPreviewer from './wmts';

// The factory reads a resource's kind and, for a tileset, asks what it holds. Nothing else, so a
// plain object stands in for one - and using a real class here would prove less, since the point
// is that nothing is dispatched on the class.
const resourceOfKind = (kind: string, extra: object = {}) => ({ kind, id: 'test-record', url: 'https://example.com/data', ...extra }) as unknown as Resource;

// Every kind that resolves without reading anything remote. Note the three that the old instanceof
// ladder had to hand-order: an index map and an ArcGIS feature layer are both kinds of GeoJSON, so
// listing either after 'geojson' would have drawn it as plain GeoJSON.
const SYNCHRONOUS: [ResourceKind, new (...args: never[]) => unknown][] = [
  ['iiif-image', ImagePreviewer],
  ['iiif-manifest', ImagePreviewer],
  ['geojson', GeoJsonPreviewer],
  ['openindexmap', OpenIndexMapPreviewer],
  ['esri-feature-layer', EsriFeatureLayerPreviewer],
  ['esri-dynamic-map-layer', EsriDynamicMapLayerPreviewer],
  ['esri-image-map-layer', EsriImageMapLayerPreviewer],
  ['esri-tiled-map-layer', EsriTiledMapLayerPreviewer],
  ['wms', WmsPreviewer],
  ['wmts', WmtsPreviewer],
  ['cog', CogPreviewer],
  ['tms', RasterPreviewer],
  ['xyz', RasterPreviewer],
];

describe('previewersFor', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(SYNCHRONOUS)('previews a %s resource with the previewer written for it', async (kind, expected) => {
    const previewers = await previewersFor(resourceOfKind(kind));

    expect(previewers).toHaveLength(1);
    // The exact class, not `instanceof`: half of these extend one of the others, and being handed
    // the parent is precisely the failure the old ordered ladder could produce
    expect(previewers[0].constructor).toBe(expected);
  });

  // These were the ladder's only async branches, and the reason the whole list is built async
  describe('a tileset that could hold either kind of tiles', () => {
    it.each([
      ['pmtiles', true, PMTilesVectorPreviewer],
      ['pmtiles', false, PMTilesRasterPreviewer],
      ['tilejson', true, TileJsonVectorPreviewer],
      ['tilejson', false, TileJsonRasterPreviewer],
    ] as const)('reads a %s archive that says isVector=%s and picks accordingly', async (kind, isVector, expected) => {
      const [previewer] = await previewersFor(resourceOfKind(kind, { isVector: async () => isVector }));

      expect(previewer.constructor).toBe(expected);
    });

    // Losing the tab would hide the broken reference; the raster previewer will fail on the same
    // URL and that failure is what reaches the user
    it.each(['pmtiles', 'tilejson'] as const)('still offers a tab for a %s archive whose header cannot be read', async kind => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const unreadable = resourceOfKind(kind, {
        isVector: async () => {
          throw new Error('offline');
        },
      });

      const [previewer] = await previewersFor(unreadable);

      expect(previewer.constructor).toBe(kind === 'pmtiles' ? PMTilesRasterPreviewer : TileJsonRasterPreviewer);
      expect(warn).toHaveBeenCalled();
    });
  });

  it('offers nothing for a resource it does not recognize, rather than failing the record', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(await previewersFor(resourceOfKind('something-newer'))).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });
});

describe('previewersForResources', () => {
  it('keeps the previews of a record in the order its resources were listed', async () => {
    const previewers = await previewersForResources([resourceOfKind('iiif-image'), resourceOfKind('wms'), resourceOfKind('geojson')]);

    expect(previewers.map(previewer => previewer.renderer)).toEqual(['image', 'map', 'map']);
  });

  // Each preview is one tab, so two that landed on the same id would collide in the tab group
  it('gives every preview of a record its own id', async () => {
    const previewers = await previewersForResources([resourceOfKind('iiif-image'), resourceOfKind('iiif-manifest'), resourceOfKind('wms')]);
    const ids = previewers.map(previewer => previewer.previewId);

    expect(new Set(ids).size).toEqual(ids.length);
    expect(ids).toEqual(['test-record-iiif-image-image', 'test-record-iiif-manifest-image', 'test-record-wms-map']);
  });

  it('offers nothing for a record with no resources', async () => {
    expect(await previewersForResources([])).toEqual([]);
  });
});
