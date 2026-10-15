import { describe, it, expect, vi, beforeEach, afterEach } from '@stencil/vitest';
import type { MapLibreMap } from 'maplibre-gl';

import IndexMapMosaic from './mosaic';
import OpenIndexMapPreviewer from './openindexmap';
import { scalarGetTileData } from '../cog-pipeline';
import { DEFAULT_COLOR_RAMP } from '../colormap';
import OpenIndexMapResource from '../resources/openindexmap';
import type { MapLibreStyle } from '../themes/maplibre';

// Enough of a MapLibre map for the outlines, which MapLibre draws, and for the camera and events
// the mosaic watches. The mosaic itself never reaches the style: deck.gl draws it through an overlay.
class FakeMap {
  sources = new Map<string, any>();
  layers = new Map<string, any>();
  _controls: unknown[] = [];
  zoom = 3;

  getSource(id: string) {
    return this.sources.get(id);
  }
  addSource(id: string, spec: any) {
    this.sources.set(id, spec);
  }
  removeSource(id: string) {
    this.sources.delete(id);
  }
  getLayer(id: string) {
    return this.layers.get(id);
  }
  addLayer(layer: any) {
    this.layers.set(layer.id, layer);
  }
  removeLayer(id: string) {
    this.layers.delete(id);
  }
  setPaintProperty(id: string, name: string, value: unknown) {
    const layer = this.layers.get(id);
    if (!layer) throw new Error(`No layer ${id} to paint`);
    layer.paint = { ...layer.paint, [name]: value };
  }
  setLayoutProperty(id: string, name: string, value: unknown) {
    const layer = this.layers.get(id);
    if (!layer) throw new Error(`No layer ${id} to lay out`);
    layer.layout = { ...layer.layout, [name]: value };
  }
  addControl(control: unknown) {
    this._controls.push(control);
  }
  getZoom() {
    return this.zoom;
  }
  isStyleLoaded() {
    return true;
  }

  listeners = new Map<string, Set<() => void>>();
  on(event: string, fn: () => void) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
  }
  once(event: string, fn: () => void) {
    this.on(event, fn);
  }
  off(event: string, fn: () => void) {
    this.listeners.get(event)?.delete(fn);
  }
  emit(event: string) {
    this.listeners.get(event)?.forEach(fn => fn());
  }
  listenerCount(event: string) {
    return this.listeners.get(event)?.size ?? 0;
  }
}

// Records the props the mosaic hands deck.gl, which is the whole of how it's drawn
class FakeOverlay {
  props: { layers?: any[] }[] = [];

  setProps(props: { layers?: any[] }) {
    this.props.push(props);
  }

  get mosaic() {
    return this.props[this.props.length - 1]?.layers?.[0];
  }
}

// A one-degree DEM tile, as 3DEP publishes them: a tiled COG of floats with statistics on record
const demTile = (min: number, max: number) => ({
  isTiled: true,
  overviews: [{}],
  tileCount: { x: 43, y: 43 },
  cachedTags: { sampleFormat: [3], samplesPerPixel: 1 },
  gdalMetadata: { bandStatistics: new Map([[1, { min, max, mean: null, std: null, validPercent: null }]]) },
});

// A scanned topo: three bands of bytes, which upstream's own pipeline draws
const SCAN = { isTiled: true, overviews: [{}], tileCount: { x: 13, y: 16 }, cachedTags: { sampleFormat: [1, 1, 1], samplesPerPixel: 3 } };

// A GeoTIFF that was never made a COG: one strip after another, and no overviews
const STRIPPED = { isTiled: false, overviews: [], tileCount: { x: 1, y: 1 } };

const tif = (name: string) => `https://example.com/sheets/${name}.tif`;

const square = (x: number, y: number): GeoJSON.Polygon => ({
  type: 'Polygon',
  coordinates: [
    [
      [x, y],
      [x + 1, y],
      [x + 1, y + 1],
      [x, y + 1],
      [x, y],
    ],
  ],
});

const INDEX_MAP: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', geometry: square(-106, 39), properties: { label: 'n40w106', download: tif('n40w106') } },
    { type: 'Feature', geometry: square(-105, 39), properties: { label: 'n40w105', download: tif('n40w105') } },
  ],
};

// What the mosaic is handed in a test instead of deck.gl's overlay and real reads
type Fakes = { overlay: FakeOverlay; geotiffs: Map<string, unknown>; reads: string[] };

class TestMosaic extends IndexMapMosaic {
  constructor(
    resource: OpenIndexMapResource,
    collection: unknown,
    private fakes: Fakes,
  ) {
    super(resource, collection);
  }

  protected getDeckOverlay() {
    return this.fakes.overlay as never;
  }

  protected createDecoderPool() {
    return {} as never;
  }

  protected async loadGeoTIFF(url: string) {
    this.fakes.reads.push(url);
    const geotiff = this.fakes.geotiffs.get(url);
    if (!geotiff) throw new Error(`Failed to HEAD ${url}`);
    return geotiff as never;
  }
}

// The index map's own preview, with a mosaic of fakes in place of the one it would load
class TestIndexMapPreviewer extends OpenIndexMapPreviewer implements Fakes {
  overlay = new FakeOverlay();

  // What each sheet's read hands back, by URL; a sheet missing from here fails to open
  geotiffs = new Map<string, unknown>([
    [tif('n40w106'), demTile(1500, 4300)],
    [tif('n40w105'), demTile(1200, 2000)],
  ]);
  reads: string[] = [];
  mosaicsCreated = 0;

  protected async createMosaic(collection: unknown) {
    this.mosaicsCreated += 1;
    return new TestMosaic(this.resource, collection, this);
  }

  // The deck.gl layer the mosaic draws a sheet with, once that sheet has been read
  async sheetLayer(index: number) {
    const sheet = this.overlay.mosaic.props.sources[index];
    const data = await this.overlay.mosaic.props.getSource(sheet, {});
    return this.overlay.mosaic.props.renderSource(sheet, { data });
  }
}

const style = { opacity: 0.8, boundsOpacity: 0.5, textFont: 'Noto Sans Regular', textSize: 12 } as MapLibreStyle;

const RESOURCE_ID = 'usgs-tnm-index-dem13';
const MOSAIC_ROW = `${RESOURCE_ID}-mosaic`;
const OUTLINES = `${RESOURCE_ID}-geojson-indexmap-polygon-outlines`;

const previewerFor = () => {
  const map = new FakeMap();
  const previewer = new TestIndexMapPreviewer(new OpenIndexMapResource(RESOURCE_ID, 'https://example.com/index-map.geojson')).attach(map as unknown as MapLibreMap, style);
  return { map, previewer };
};

// Everything the look for a mosaic waits on here resolves at once, so it's done by the next task
const settled = () => new Promise(resolve => setTimeout(resolve, 0));

// Draw the index map, and let it find its mosaic
const drawn = async (previewer: TestIndexMapPreviewer) => {
  await previewer.preview();
  await settled();
};

const titles = (previewer: TestIndexMapPreviewer) => previewer.previewLayers.map(({ title }) => title);
const mosaicRow = (previewer: TestIndexMapPreviewer) => previewer.previewLayers.find(({ id }) => id === MOSAIC_ROW);

let index = INDEX_MAP;

beforeEach(() => {
  index = INDEX_MAP;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => index })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('OpenIndexMapPreviewer with a mosaic', () => {
  describe('finding it', () => {
    it('draws the outlines first, as an index map always has been', async () => {
      const { previewer } = previewerFor();
      await previewer.preview();

      expect(titles(previewer)).toEqual(['Geometry', 'Sheet labels']);
      expect(previewer.overlay.props).toEqual([]);
    });

    it('adds the mosaic between the outlines and their labels once its first sheet has been read', async () => {
      const { previewer } = previewerFor();
      const onLayersChanged = vi.fn();
      previewer.onLayersChanged = onLayersChanged;

      await drawn(previewer);

      expect(titles(previewer)).toEqual(['Geometry', 'Mosaic', 'Sheet labels']);
      expect(mosaicRow(previewer)!.styleLayers).toEqual([{ id: MOSAIC_ROW, type: 'custom' }]);
      expect(previewer.reads).toEqual([tif('n40w106')]);
      expect(onLayersChanged).toHaveBeenCalledTimes(1);
    });

    it('is still the one preview of the index map', async () => {
      const resource = new OpenIndexMapResource(RESOURCE_ID, 'https://example.com/index-map.geojson');

      expect(new TestIndexMapPreviewer(resource).previewId).toEqual(new OpenIndexMapPreviewer(resource).previewId);
    });

    // Nothing worth loading deck.gl for, let alone reading a sheet
    it('looks no further for an index map whose sheets link no GeoTIFFs', async () => {
      index = {
        type: 'FeatureCollection',
        features: INDEX_MAP.features.map(feature => ({ ...feature, properties: { label: 'sheet', download: 'https://example.com/sheet.zip' } })),
      };
      const { previewer } = previewerFor();

      await drawn(previewer);

      expect(titles(previewer)).toEqual(['Geometry', 'Sheet labels']);
      expect(previewer.mosaicsCreated).toEqual(0);
    });

    it('adds no mosaic when the first sheet is a GeoTIFF that was never made a COG', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { previewer } = previewerFor();
      previewer.geotiffs.set(tif('n40w106'), STRIPPED);

      await drawn(previewer);

      expect(titles(previewer)).toEqual(['Geometry', 'Sheet labels']);
      expect(previewer.overlay.props).toEqual([]);
      expect(warn).toHaveBeenCalled();
    });

    // The outlines are the index map; a mosaic that can't be had is no reason to fail them
    it('still draws the outlines when the first sheet will not open', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { previewer } = previewerFor();
      previewer.geotiffs.delete(tif('n40w106'));

      await expect(drawn(previewer)).resolves.toBeUndefined();
      expect(titles(previewer)).toEqual(['Geometry', 'Sheet labels']);
    });

    // A theme change draws the outlines again, and what the index map links hasn't changed
    it('looks for a mosaic once, and lists it again straight away when the outlines are drawn again', async () => {
      const { previewer } = previewerFor();
      await drawn(previewer);

      await previewer.preview();

      expect(titles(previewer)).toEqual(['Geometry', 'Mosaic', 'Sheet labels']);
      expect(previewer.mosaicsCreated).toEqual(1);
      expect(previewer.reads).toEqual([tif('n40w106')]);
    });

    it('lists the mosaic once when it is found while the outlines are being drawn again', async () => {
      const { previewer } = previewerFor();
      await previewer.preview();
      await previewer.preview();
      await settled();

      expect(titles(previewer)).toEqual(['Geometry', 'Mosaic', 'Sheet labels']);
    });

    it('draws nothing on a preview cleared before the mosaic was found, and keeps it for the next draw', async () => {
      const { previewer } = previewerFor();
      await previewer.preview();
      await previewer.clearPreview();
      await settled();

      expect(previewer.previewLayers).toEqual([]);
      expect(previewer.overlay.props.some(({ layers }) => layers?.length)).toBe(false);

      await previewer.preview();
      expect(titles(previewer)).toEqual(['Geometry', 'Mosaic', 'Sheet labels']);
    });

    it('ramps a mosaic of DEM tiles across the first tile’s values to begin with', async () => {
      const { previewer } = previewerFor();
      await drawn(previewer);

      expect(mosaicRow(previewer)!.defaultColorRamp).toEqual(DEFAULT_COLOR_RAMP);
      expect(mosaicRow(previewer)!.colorRampRange).toEqual([1500, 4300]);
    });

    it('offers no ramp for a mosaic of scans', async () => {
      const { previewer } = previewerFor();
      previewer.geotiffs.set(tif('n40w106'), SCAN);
      await drawn(previewer);

      expect(mosaicRow(previewer)!.defaultColorRamp).toBeUndefined();
      expect(mosaicRow(previewer)!.colorRampRange).toBeUndefined();
    });

    it('hands deck.gl one mosaic of every sheet, drawn only once a view holds few enough of them', async () => {
      const { previewer } = previewerFor();
      await drawn(previewer);

      const { props } = previewer.overlay.mosaic;
      expect(previewer.overlay.mosaic.constructor.name).toEqual('MosaicLayer');
      expect(props.sources.map(({ url }: { url: string }) => url)).toEqual([tif('n40w106'), tif('n40w105')]);
      expect(props.minZoom).toEqual(5);
      expect(props.maxCacheSize).toEqual(0);
    });

    // Over the fills, so they show only where a sheet has no data, and under the outlines, so the
    // sheets can still be told apart and the selected one still stands out
    it('draws the mosaic under the sheet outlines', async () => {
      const { previewer } = previewerFor();
      await drawn(previewer);

      expect(previewer.overlay.mosaic.props.beforeId).toEqual(OUTLINES);
    });
  });

  describe('sheets', () => {
    it('draws a DEM tile through the scalar pipeline, at the mosaic’s opacity', async () => {
      const { previewer } = previewerFor();
      await drawn(previewer);

      const layer = await previewer.sheetLayer(0);
      expect(layer.props.geotiff).toBe(previewer.geotiffs.get(tif('n40w106')));
      expect(layer.props.getTileData).toBe(scalarGetTileData);
      expect(layer.props.updateTriggers.renderTile).toEqual([DEFAULT_COLOR_RAMP, 1500, 4300]);
      expect(layer.props.opacity).toEqual(0.8);
    });

    it('draws a scan through upstream’s own pipeline', async () => {
      const { previewer } = previewerFor();
      previewer.geotiffs.set(tif('n40w106'), SCAN);
      await drawn(previewer);

      const layer = await previewer.sheetLayer(0);
      expect(layer.props.getTileData).not.toBe(scalarGetTileData);
      expect(layer.props.updateTriggers).toEqual({});
    });

    // So its collar isn't drawn over the edges of the sheets around it
    it('clips a scan to its own outline', async () => {
      const { previewer } = previewerFor();
      previewer.geotiffs.set(tif('n40w106'), SCAN);
      await drawn(previewer);

      const layer = await previewer.sheetLayer(0);
      expect(layer.constructor.name).toEqual('ClippedCOGLayer');
      expect(layer.props.cutline).toEqual([-106, 39, -105, 40]);
    });

    // 3DEP's tiles run a few pixels past their degree, and the strip two neighbours share would be
    // drawn twice below full opacity
    it('clips a DEM tile to its own outline too, keeping its ramp', async () => {
      const { previewer } = previewerFor();
      await drawn(previewer);

      const layer = await previewer.sheetLayer(0);
      expect(layer.constructor.name).toEqual('ClippedCOGLayer');
      expect(layer.props.cutline).toEqual([-106, 39, -105, 40]);
      expect(layer.props.getTileData).toBe(scalarGetTileData);
    });

    it('draws nothing for a sheet that turns out not to be a COG', async () => {
      const { previewer } = previewerFor();
      previewer.geotiffs.set(tif('n40w105'), STRIPPED);
      await drawn(previewer);

      expect(await previewer.sheetLayer(1)).toBeNull();
    });

    it('reads each sheet once, however often it comes into view', async () => {
      const { previewer } = previewerFor();
      await drawn(previewer);

      await previewer.sheetLayer(0);
      await previewer.sheetLayer(0);

      expect(previewer.reads).toEqual([tif('n40w106')]);
    });

    // A sheet that leaves the view and comes straight back can join a read its own departure cancelled
    it('reads a sheet again when a read it joined was abandoned', async () => {
      const { previewer } = previewerFor();
      await drawn(previewer);

      const abort = Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
      const load = vi.spyOn(TestMosaic.prototype as any, 'loadGeoTIFF').mockRejectedValueOnce(abort);
      const sheet = previewer.overlay.mosaic.props.sources[1];

      expect(await previewer.overlay.mosaic.props.getSource(sheet, { signal: new AbortController().signal })).toEqual({
        geotiff: previewer.geotiffs.get(tif('n40w105')),
        range: [1200, 2000],
      });
      expect(load).toHaveBeenCalledTimes(2);
    });

    it('lets a sheet that will not open be a hole in the mosaic', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const onError = vi.fn();
      const { previewer } = previewerFor();
      previewer.onError = onError;
      await drawn(previewer);

      previewer.overlay.mosaic.props.onSourceError(previewer.overlay.mosaic.props.sources[1], { error: new Error('Failed to HEAD') });

      expect(onError).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(`Could not open ${tif('n40w105')} for the mosaic:`, expect.any(Error));
    });
  });

  describe('stretching the ramp', () => {
    const loadView = async (previewer: TestIndexMapPreviewer) => {
      const { sources, getSource } = previewer.overlay.mosaic.props;
      return await Promise.all(sources.map(async (source: unknown) => ({ source, data: await getSource(source, {}) })));
    };

    it('stretches across every sheet in view, once they have all been read', async () => {
      const { previewer } = previewerFor();
      await drawn(previewer);
      const onLayersChanged = vi.fn();
      previewer.onLayersChanged = onLayersChanged;

      previewer.overlay.mosaic.props.onViewportLoad(await loadView(previewer));

      expect(mosaicRow(previewer)!.colorRampRange).toEqual([1200, 4300]);
      expect(onLayersChanged).toHaveBeenCalledTimes(1);
    });

    // deck.gl drops a setProps made from inside its own update, which is where onViewportLoad is called
    it('redraws the sheets with the new range once deck.gl has finished its update', async () => {
      const { previewer } = previewerFor();
      await drawn(previewer);
      const drawCount = previewer.overlay.props.length;

      previewer.overlay.mosaic.props.onViewportLoad(await loadView(previewer));
      expect(previewer.overlay.props.length).toEqual(drawCount);

      await Promise.resolve();
      expect(previewer.overlay.props.length).toEqual(drawCount + 1);
      expect((await previewer.sheetLayer(0)).props.updateTriggers.renderTile).toEqual([DEFAULT_COLOR_RAMP, 1200, 4300]);
    });

    it('leaves the panel alone when the range has not changed', async () => {
      const { previewer } = previewerFor();
      await drawn(previewer);
      const onLayersChanged = vi.fn();
      previewer.onLayersChanged = onLayersChanged;

      const view = await loadView(previewer);
      previewer.overlay.mosaic.props.onViewportLoad(view);
      previewer.overlay.mosaic.props.onViewportLoad(view);

      expect(onLayersChanged).toHaveBeenCalledTimes(1);
    });

    it('keeps the stretched range across a basemap swap', async () => {
      const { previewer } = previewerFor();
      await drawn(previewer);
      previewer.overlay.mosaic.props.onViewportLoad(await loadView(previewer));

      await previewer.preview();

      expect(mosaicRow(previewer)!.colorRampRange).toEqual([1200, 4300]);
    });
  });

  // From the index map's record, which is the only place an index map of 3DEP's tiles can say it
  describe('the legend', () => {
    const ELEVATION = { name: 'Elevation', unit: 'meters', datum: 'North American Vertical Datum of 1988' };

    it('titles a mosaic of DEM tiles by what the record says their values measure', async () => {
      const { previewer } = previewerFor();
      vi.spyOn(OpenIndexMapResource.prototype, 'getQuantity').mockResolvedValue(ELEVATION);

      await drawn(previewer);

      expect(mosaicRow(previewer)!.quantity).toEqual(ELEVATION);
    });

    it('takes a title that arrives after the mosaic is drawn, and says the row has changed', async () => {
      let answer: (quantity: typeof ELEVATION) => void = () => {};
      vi.spyOn(OpenIndexMapResource.prototype, 'getQuantity').mockReturnValue(new Promise(resolve => (answer = resolve)));
      const { previewer } = previewerFor();
      await drawn(previewer);
      const onLayersChanged = vi.fn();
      previewer.onLayersChanged = onLayersChanged;

      answer(ELEVATION);
      await vi.waitFor(() => expect(mosaicRow(previewer)!.quantity).toEqual(ELEVATION));
      expect(onLayersChanged).toHaveBeenCalled();
    });

    // A scan has no ramp, so no legend for the title to go on
    it('titles nothing for a mosaic of scans', async () => {
      const { previewer } = previewerFor();
      previewer.geotiffs.set(tif('n40w106'), SCAN);
      vi.spyOn(OpenIndexMapResource.prototype, 'getQuantity').mockResolvedValue(ELEVATION);

      await drawn(previewer);

      expect(mosaicRow(previewer)!.quantity).toBeUndefined();
    });

    it('leaves the row as it is when the record says nothing', async () => {
      const { previewer } = previewerFor();
      await drawn(previewer);

      expect(mosaicRow(previewer)!.quantity).toBeUndefined();
      expect(mosaicRow(previewer)!.title).toEqual('Mosaic');
    });

    // What the colours of the outlines mean says nothing about a mosaic drawn without them
    it('keeps the key to the outlines’ colours to the outlines', async () => {
      const { previewer } = previewerFor();
      await drawn(previewer);

      previewer.applyLayerState(new Map([[previewer.previewLayers[0].id, { visible: false, opacity: 0.5 }]]));

      expect(previewer.legendEntries).toEqual([]);
    });
  });

  describe('layer state', () => {
    it('sends the mosaic’s opacity to every sheet', async () => {
      const { previewer } = previewerFor();
      await drawn(previewer);

      previewer.applyLayerState(new Map([[MOSAIC_ROW, { visible: true, opacity: 0.25 }]]));

      expect((await previewer.sheetLayer(0)).props.opacity).toEqual(0.25);
    });

    it('hides the mosaic as a whole', async () => {
      const { previewer } = previewerFor();
      await drawn(previewer);

      previewer.applyLayerState(new Map([[MOSAIC_ROW, { visible: false, opacity: 0.8 }]]));

      expect(previewer.overlay.mosaic.props.visible).toBe(false);
    });

    it('styles the outlines through MapLibre, as it always has', async () => {
      const { map, previewer } = previewerFor();
      await drawn(previewer);

      previewer.applyLayerState(new Map([[previewer.previewLayers[0].id, { visible: true, opacity: 0.3 }]]));

      // Inside the expression that keeps the selected sheet solid
      expect(map.getLayer(`${RESOURCE_ID}-geojson-indexmap-polygons`).paint['fill-opacity']).toContain(0.3);
    });

    // A query naming a layer the style doesn't hold comes back empty for every layer it names
    it('never asks MapLibre about the mosaic on a click', async () => {
      const { previewer } = previewerFor();
      await drawn(previewer);

      expect(previewer.visibleLayerIds).not.toContain(MOSAIC_ROW);
      expect(previewer.visibleLayerIds).toContain(`${RESOURCE_ID}-geojson-indexmap-polygons`);
    });
  });

  describe('the notice', () => {
    it('says to zoom in while the view is too far out for the mosaic', async () => {
      const { map, previewer } = previewerFor();
      const onNotice = vi.fn();
      previewer.onNotice = onNotice;
      await drawn(previewer);

      expect(onNotice).toHaveBeenLastCalledWith('Zoom in to see mosaic.');

      map.zoom = 7;
      map.emit('zoomend');
      expect(onNotice).toHaveBeenLastCalledWith(undefined);
    });

    it('says nothing about a mosaic the reader has switched off', async () => {
      const { previewer } = previewerFor();
      const onNotice = vi.fn();
      previewer.onNotice = onNotice;
      await drawn(previewer);

      previewer.applyLayerState(new Map([[MOSAIC_ROW, { visible: false, opacity: 0.8 }]]));

      expect(onNotice).toHaveBeenLastCalledWith(undefined);
    });

    // An index map with no mosaic is drawn as it always was, which says nothing about zooming
    it('says nothing for an index map with no mosaic', async () => {
      index = { type: 'FeatureCollection', features: INDEX_MAP.features.map(feature => ({ ...feature, properties: { label: 'sheet' } })) };
      const { previewer } = previewerFor();
      const onNotice = vi.fn();
      previewer.onNotice = onNotice;

      await drawn(previewer);

      expect(onNotice).not.toHaveBeenCalled();
    });
  });

  describe('clearPreview', () => {
    it('takes the mosaic off the overlay, says nothing more, and stops watching the map', async () => {
      const { map, previewer } = previewerFor();
      const onNotice = vi.fn();
      previewer.onNotice = onNotice;
      await drawn(previewer);

      await previewer.clearPreview();

      expect(previewer.overlay.props.at(-1)).toEqual({ layers: [] });
      expect(onNotice).toHaveBeenLastCalledWith(undefined);
      expect(map.listenerCount('zoomend')).toEqual(0);
      expect(map.listenerCount('projectiontransition')).toEqual(0);
    });

    // A theme change draws the preview again with no clearPreview between
    it('leaves one listener of each kind after drawing twice', async () => {
      const { map, previewer } = previewerFor();
      await drawn(previewer);
      await previewer.preview();

      expect(map.listenerCount('zoomend')).toEqual(1);
      expect(map.listenerCount('projectiontransition')).toEqual(1);
    });
  });
});
