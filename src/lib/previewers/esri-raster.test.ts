import { describe, it, expect, beforeEach, vi } from '@stencil/vitest';

import EsriDynamicMapLayerPreviewer from './esri-dynamic-map-layer';
import EsriImageMapLayerPreviewer from './esri-image-map-layer';
import EsriTiledMapLayerPreviewer from './esri-tiled-map-layer';
import EsriDynamicMapLayerResource from '../resources/esri-dynamic-map-layer';
import EsriImageMapLayerResource from '../resources/esri-image-map-layer';
import EsriTiledMapLayerResource from '../resources/esri-tiled-map-layer';
import type EsriResource from '../resources/esri';
import type { EsriMetadata } from '../esri';
import type { PixelWindow } from '../geometry';
import type { MapLibreStyle } from '../themes/maplibre';

// Just enough of a MapLibre map to record what the previewer adds, removes and draws
class FakeMap {
  sources = new Map<string, { type: string; data?: GeoJSON.GeoJSON; tiles?: string[]; scheme?: string; tileSize?: number; minzoom?: number; maxzoom?: number }>();
  layers = new Map<string, { id: string; type: string; source: string }>();

  getSource(id: string) {
    const source = this.sources.get(id);
    if (!source) return undefined;
    return { ...source, setData: (data: GeoJSON.GeoJSON) => (source.data = data) };
  }
  addSource(id: string, spec: { type: string }) {
    this.sources.set(id, { ...spec });
  }
  removeSource(id: string) {
    this.sources.delete(id);
  }
  getLayer(id: string) {
    return this.layers.get(id);
  }
  addLayer(layer: { id: string; type: string; source: string }) {
    // MapLibre refuses a layer whose source hasn't been added yet
    if (!this.sources.has(layer.source)) throw new Error(`No source ${layer.source} for layer ${layer.id}`);
    this.layers.set(layer.id, layer);
  }
  removeLayer(id: string) {
    this.layers.delete(id);
  }
}

// The previewer only reads the colors used by the highlight
const style = { opacity: 0.8, strokeSelectedColor: '#0a0', fillSelectedColor: '#0f0', fillHighlightOpacity: 0.8 } as MapLibreStyle;

const SERVICE = 'https://example.org/arcgis/rest/services/Geology/Glacial_Boundaries/MapServer';
const IMAGE_SERVICE = 'https://example.org/arcgis/rest/services/NAIP/USDA_CONUS_PRIME/ImageServer';

// A window over Illinois, in EPSG:3857 meters, clicked in the middle
const WINDOW: PixelWindow = { bbox: '-9862640,5235400,-9862130,5235910', width: 51, height: 51, x: 25, y: 25 };

const MERCATOR_EXTENT = 20037508.342789244;

const XYZ_CACHE: EsriMetadata = {
  capabilities: 'Map,TilesOnly',
  singleFusedMapCache: true,
  tileInfo: {
    rows: 256,
    cols: 256,
    origin: { x: -MERCATOR_EXTENT, y: MERCATOR_EXTENT },
    spatialReference: { wkid: 102100, latestWkid: 3857 },
    lods: [0, 1, 2, 3].map(level => ({ level, resolution: (2 * MERCATOR_EXTENT) / 256 / 2 ** level })),
  },
};

// Reads a hand-built service description instead of fetching one
const stubMetadata = <T extends EsriResource>(resource: T, metadata: EsriMetadata) => {
  (resource as unknown as { getMetadata: () => Promise<EsriMetadata> }).getMetadata = async () => metadata;
  return resource;
};

let map: FakeMap;

beforeEach(() => {
  map = new FakeMap();
});

const dynamicPreviewer = (metadata: EsriMetadata = { capabilities: 'Map,Query,Data' }) => {
  const resource = stubMetadata(new EsriDynamicMapLayerResource('glacial', SERVICE), metadata);
  return new EsriDynamicMapLayerPreviewer(resource, map as unknown as maplibregl.Map, style);
};

describe('EsriRasterPreviewer#preview', () => {
  it('draws the export tiles with a highlight source alongside them', async () => {
    const previewer = dynamicPreviewer();
    await previewer.preview();

    expect([...map.sources.keys()]).toEqual(['glacial-esri-dynamic-map-layer-highlight', 'glacial-esri-dynamic-map-layer']);
    expect(map.sources.get('glacial-esri-dynamic-map-layer-highlight')?.type).toEqual('geojson');
    expect(map.sources.get('glacial-esri-dynamic-map-layer')?.tiles?.[0]).toContain('/export?');
  });

  it('draws the highlight over the tiles', async () => {
    const previewer = dynamicPreviewer();
    await previewer.preview();

    // Order is paint order: the raster layer first, then the layers that highlight over it
    expect([...map.layers.keys()]).toEqual([
      'glacial-esri-dynamic-map-layer',
      'glacial-esri-dynamic-map-layer-highlight-outlines',
      'glacial-esri-dynamic-map-layer-highlight-points',
    ]);
  });

  it('offers to inspect a service that answers identify requests', async () => {
    const previewer = dynamicPreviewer({ capabilities: 'Map,Query,Data' });
    expect(previewer.canInspect).toBe(false);

    await previewer.preview();
    expect(previewer.canInspect).toBe(true);
  });

  it('does not offer to inspect a service that only hands back tiles', async () => {
    const previewer = dynamicPreviewer({ capabilities: 'Map,TilesOnly' });
    await previewer.preview();

    expect(previewer.canInspect).toBe(false);
  });

  it('still draws the tiles when the service will not say whether it can be inspected', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const resource = new EsriDynamicMapLayerResource('glacial', SERVICE);
    (resource as unknown as { getMetadata: () => Promise<EsriMetadata> }).getMetadata = async () => {
      throw new Error('unreachable');
    };
    const previewer = new EsriDynamicMapLayerPreviewer(resource, map as unknown as maplibregl.Map, style);

    await previewer.preview();

    expect(map.layers.has('glacial-esri-dynamic-map-layer')).toBe(true);
    expect(previewer.canInspect).toBe(false);
    warn.mockRestore();
  });

  it('gives each kind of ArcGIS layer its own source, so a record can carry several', async () => {
    const dynamic = dynamicPreviewer();
    const image = new EsriImageMapLayerPreviewer(stubMetadata(new EsriImageMapLayerResource('glacial', IMAGE_SERVICE), {}), map as unknown as maplibregl.Map, style);
    const tiled = new EsriTiledMapLayerPreviewer(stubMetadata(new EsriTiledMapLayerResource('glacial', SERVICE), XYZ_CACHE), map as unknown as maplibregl.Map, style);

    await dynamic.preview();
    await image.preview();
    await tiled.preview();

    expect(map.sources.has('glacial-esri-dynamic-map-layer')).toBe(true);
    expect(map.sources.has('glacial-esri-image-map-layer')).toBe(true);
    expect(map.sources.has('glacial-esri-tiled-map-layer')).toBe(true);
  });
});

describe('EsriTiledMapLayerPreviewer#preview', () => {
  it('passes the cache tiling straight through to the source', async () => {
    const resource = stubMetadata(new EsriTiledMapLayerResource('mn-landcover', SERVICE), XYZ_CACHE);
    const previewer = new EsriTiledMapLayerPreviewer(resource, map as unknown as maplibregl.Map, style);
    await previewer.preview();

    const source = map.sources.get('mn-landcover-esri-tiled-map-layer');
    expect(source?.tiles).toEqual([`${SERVICE}/tile/{z}/{y}/{x}`]);
    expect(source?.scheme).toEqual('xyz');
    expect(source?.minzoom).toEqual(0);
    expect(source?.maxzoom).toEqual(3);
  });
});

describe('EsriRasterPreviewer#clearPreview', () => {
  it('removes the highlight along with the tiles', async () => {
    const previewer = dynamicPreviewer();
    await previewer.preview();
    await previewer.clearPreview();

    expect(map.sources.size).toEqual(0);
    expect(map.layers.size).toEqual(0);
  });
});

describe('EsriRasterPreviewer#inspect', () => {
  const identifyResult = {
    layerName: 'IL_Glacial_Bndys_Py',
    attributes: { EPISODE: 'Wisconsin' },
    geometry: {
      rings: [
        [
          [-9862637, 5235415],
          [-9862137, 5235415],
          [-9862137, 5235915],
          [-9862637, 5235415],
        ],
      ],
    },
  };

  it('reprojects what the service returned into the degrees MapLibre sources use', async () => {
    const previewer = dynamicPreviewer();
    await previewer.preview();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ results: [identifyResult] }) }));
    const features = await previewer.inspect(WINDOW);
    vi.unstubAllGlobals();

    expect(features).toHaveLength(1);
    const [longitude, latitude] = (features[0].geometry as GeoJSON.Polygon).coordinates[0][0];
    expect(longitude).toBeCloseTo(-88.6, 1);
    expect(latitude).toBeCloseTo(42.5, 1);
  });

  it('names the source the features came from, so a selection can be tracked', async () => {
    const previewer = dynamicPreviewer();
    await previewer.preview();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ results: [identifyResult] }) }));
    const features = await previewer.inspect(WINDOW);
    vi.unstubAllGlobals();

    expect(features[0].source).toEqual('glacial-esri-dynamic-map-layer');
  });

  it('keeps a feature the service returned without geometry, which still has attributes to show', async () => {
    const previewer = dynamicPreviewer();
    await previewer.preview();

    const results = [{ attributes: { EPISODE: 'Illinois' }, geometry: null }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ results }) }));
    const features = await previewer.inspect(WINDOW);
    vi.unstubAllGlobals();

    expect(features).toHaveLength(1);
    expect(features[0].geometry).toBeNull();

    // And the highlight simply has nothing to draw for it
    previewer.highlightFeatures(features);
    expect(map.sources.get('glacial-esri-dynamic-map-layer-highlight')?.data).toEqual({ type: 'FeatureCollection', features: [] });
  });
});
