import { describe, it, expect, vi, afterEach } from '@stencil/vitest';

import { previewersFor, previewersForResources } from './factory';
import type Resource from '../resources/resource';
import type { ResourceKind } from '../resources/resource';

import CogPreviewer from './cog';
import DeckCogPreviewer from './cog-deck';
import GeoreferencePreviewer from './georeference';
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
// listing either after 'geojson' would have drawn it as plain GeoJSON. A manifest and a COG are not
// here: one has to ask whether it's georeferenced, and the other loads deck.gl on demand.
const SYNCHRONOUS: [ResourceKind, new (...args: never[]) => unknown][] = [
  ['iiif-image', ImagePreviewer],
  ['geojson', GeoJsonPreviewer],
  ['openindexmap', OpenIndexMapPreviewer],
  ['esri-feature-layer', EsriFeatureLayerPreviewer],
  ['esri-dynamic-map-layer', EsriDynamicMapLayerPreviewer],
  ['esri-image-map-layer', EsriImageMapLayerPreviewer],
  ['esri-tiled-map-layer', EsriTiledMapLayerPreviewer],
  ['wms', WmsPreviewer],
  ['wmts', WmtsPreviewer],
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

  // The case the whole list is plural for: one resource, two readings of it
  describe('a manifest that may be georeferenced', () => {
    const manifest = (isGeoreferenced: () => Promise<boolean>) => resourceOfKind('iiif-manifest', { isGeoreferenced });

    it('previews a plain manifest as an image and nothing else', async () => {
      const previewers = await previewersFor(manifest(async () => false));

      expect(previewers).toHaveLength(1);
      expect(previewers[0].constructor).toBe(ImagePreviewer);
    });

    it('offers a georeferenced manifest the image first and the map second', async () => {
      const previewers = await previewersFor(manifest(async () => true));

      // The image comes first because it is what the scan is; the map is a second reading of it,
      // and this order is the tab order
      expect(previewers.map(previewer => previewer.constructor)).toEqual([ImagePreviewer, GeoreferencePreviewer]);
      expect(previewers.map(previewer => previewer.renderer)).toEqual(['image', 'map']);
    });

    // Two previews of one resource, so the ids have to be told apart by more than the resource
    it('gives the two previews of one manifest different ids and different tab labels', async () => {
      const previewers = await previewersFor(resourceOfKind('iiif-manifest', { isGeoreferenced: async () => true, label: () => 'IIIF Manifest' }));

      expect(new Set(previewers.map(previewer => previewer.previewId)).size).toEqual(2);
      expect(new Set(previewers.map(previewer => previewer.label())).size).toEqual(2);
    });

    it('still offers the image when it cannot tell whether the manifest is georeferenced', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const previewers = await previewersFor(
        manifest(async () => {
          throw new Error('offline');
        }),
      );

      expect(previewers.map(previewer => previewer.constructor)).toEqual([ImagePreviewer]);
      expect(warn).toHaveBeenCalled();
    });

    // A resource built by a copy of this library from before georeferencing existed has no such
    // method to call, which throws on the way in rather than rejecting
    it('still offers the image for a resource that cannot be asked at all', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      expect((await previewersFor(resourceOfKind('iiif-manifest'))).map(previewer => previewer.constructor)).toEqual([ImagePreviewer]);
      expect(warn).toHaveBeenCalled();
    });
  });

  // Loaded on demand rather than bundled, so this also proves the chunk resolves at all
  it('previews a COG with deck.gl, which can warp one that is not already in Web Mercator', async () => {
    const [previewer] = await previewersFor(resourceOfKind('cog'));

    expect(previewer.constructor).toBe(DeckCogPreviewer);
    // The protocol previewer is still the fallback, and still the only one that can carry an
    // Authorization header, so it must remain reachable rather than being dropped
    expect(CogPreviewer).toBeDefined();
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
    const manifest = resourceOfKind('iiif-manifest', { isGeoreferenced: async () => false });
    const previewers = await previewersForResources([resourceOfKind('iiif-image'), manifest, resourceOfKind('wms')]);
    const ids = previewers.map(previewer => previewer.previewId);

    expect(new Set(ids).size).toEqual(ids.length);
    expect(ids).toEqual(['test-record-iiif-image-image', 'test-record-iiif-manifest-image', 'test-record-wms-map']);
  });

  it('offers nothing for a record with no resources', async () => {
    expect(await previewersForResources([])).toEqual([]);
  });
});
