import { describe, it, expect, vi, beforeEach, afterEach } from '@stencil/vitest';
import type { LngLatBoundsLike, MapLibreMap } from 'maplibre-gl';

import CogPreviewer from './cog';
import { scalarGetTileData } from '../cog-pipeline';
import RasterPreviewer from './raster';
import CogResource from '../resources/cog';
import { DEFAULT_COLOR_RAMP } from '../colormap';
import { defaultBeforeId, type MapLibreStyle } from '../themes/maplibre';

class FakeMap {
  sources = new Map<string, any>();
  layers = new Map<string, any>();
  _controls: unknown[] = [];

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
  addControl(control: unknown) {
    this._controls.push(control);
  }

  styleLoaded = true;
  isStyleLoaded() {
    return this.styleLoaded;
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
  setLayoutProperty(_id: string, name: string) {
    throw new Error(`MapLibre has no layer here to set ${name} on`);
  }
  setPaintProperty(_id: string, name: string) {
    throw new Error(`MapLibre has no layer here to set ${name} on`);
  }
}

class FakeOverlay {
  props: { layers?: any[] }[] = [];

  setProps(props: { layers?: any[] }) {
    this.props.push(props);
  }

  get lastLayers() {
    return this.props[this.props.length - 1]?.layers ?? [];
  }
}

const FAKE_GEOTIFF = { crs: 'EPSG:4326' };

const FAKE_SCALAR_GEOTIFF = {
  crs: 'EPSG:4326',
  cachedTags: { sampleFormat: [3], samplesPerPixel: 1 },
  gdalMetadata: { bandStatistics: new Map([[1, { min: -184.48, max: 607.27, mean: null, std: null, validPercent: null }]]) },
  overviews: [],
};

class TestCogPreviewer extends CogPreviewer {
  overlay = new FakeOverlay();

  get pool() {
    return this.decoderPool;
  }

  opened: string[] = [];
  refusal: Error | undefined;
  geotiffToLoad: unknown = FAKE_GEOTIFF;

  protected getDeckOverlay() {
    return this.overlay as never;
  }

  protected async loadGeoTIFF() {
    if (this.refusal) throw this.refusal;
    this.opened.push(this.resource.url);
    return this.geotiffToLoad as never;
  }
}

const style = { opacity: 0.8 } as MapLibreStyle;

const COG_URL = 'https://example.com/scan.tif';

const previewFor = (bounds?: LngLatBoundsLike) => {
  const map = new FakeMap();
  const previewer = new TestCogPreviewer(new CogResource('stanford-vq494qx9344', COG_URL, bounds)).attach(map as unknown as MapLibreMap, style);
  return { map, previewer };
};

describe('CogPreviewer', () => {
  it('adds nothing to the MapLibre style, since deck.gl draws through its own overlay', async () => {
    const { map, previewer } = previewFor();
    await previewer.preview();

    expect(map.sources.size).toEqual(0);
    expect(map.layers.size).toEqual(0);
    expect(previewer.sourceIds).toEqual([]);
    expect(previewer.layerIds).toEqual([]);
  });

  it('still offers the layers panel a layer to control', async () => {
    const { previewer } = previewFor();
    await previewer.preview();

    expect(previewer.previewLayers).toHaveLength(1);
    expect(previewer.previewLayers[0].styleLayers).toEqual([{ id: 'stanford-vq494qx9344-cog', type: 'custom' }]);
    expect(previewer.previewLayers[0].defaultOpacity).toEqual(0.8);
  });

  it('hands deck.gl the open COG rather than a URL for it to fetch itself', async () => {
    const { previewer } = previewFor();
    await previewer.preview();

    expect(previewer.overlay.lastLayers[0].props.geotiff).toBe(FAKE_GEOTIFF);
    expect(previewer.opened).toEqual([COG_URL]);
  });

  it('keeps the COG open across a layer rebuild', async () => {
    const { previewer } = previewFor();
    await previewer.preview();

    previewer.applyLayerState(new Map([['stanford-vq494qx9344-cog', { visible: true, opacity: 0.25 }]]));

    expect(previewer.opened).toEqual([COG_URL]);
    expect(previewer.overlay.lastLayers[0].props.geotiff).toBe(FAKE_GEOTIFF);
  });

  it('fails the preview when the COG cannot be read', async () => {
    const { previewer } = previewFor();
    previewer.refusal = new Error('Failed to HEAD scan.tif');

    await expect(previewer.preview()).rejects.toThrow('Failed to HEAD scan.tif');
  });

  it('draws at the theme opacity to begin with', async () => {
    const { previewer } = previewFor();
    await previewer.preview();

    expect(previewer.overlay.lastLayers[0].props.opacity).toEqual(0.8);
    expect(previewer.overlay.lastLayers[0].props.visible).toBe(true);
  });

  describe('applying layer state', () => {
    it('sends opacity to deck.gl as a prop', async () => {
      const { previewer } = previewFor();
      await previewer.preview();

      previewer.applyLayerState(new Map([['stanford-vq494qx9344-cog', { visible: true, opacity: 0.25 }]]));

      expect(previewer.overlay.lastLayers[0].props.opacity).toEqual(0.25);
      expect(previewer.overlay.lastLayers[0].props.visible).toBe(true);
    });

    it('hides the layer by handing deck.gl visible: false', async () => {
      const { previewer } = previewFor();
      await previewer.preview();

      previewer.applyLayerState(new Map([['stanford-vq494qx9344-cog', { visible: false, opacity: 0.8 }]]));

      expect(previewer.overlay.lastLayers[0].props.visible).toBe(false);
    });

    it('treats a fully faded layer as hidden', async () => {
      const { previewer } = previewFor();
      await previewer.preview();

      previewer.applyLayerState(new Map([['stanford-vq494qx9344-cog', { visible: true, opacity: 0 }]]));

      expect(previewer.overlay.lastLayers[0].props.visible).toBe(false);
    });

    it('keeps the same layer id so deck.gl updates rather than reloads', async () => {
      const { previewer } = previewFor();
      await previewer.preview();
      previewer.applyLayerState(new Map([['stanford-vq494qx9344-cog', { visible: true, opacity: 0.5 }]]));

      const ids = previewer.overlay.props.flatMap(p => (p.layers ?? []).map((l: any) => l.id));
      expect(new Set(ids).size).toEqual(1);
    });
  });

  describe('a scalar COG', () => {
    it("publishes the default ramp and the file's own value range on the layer", async () => {
      const { previewer } = previewFor();
      previewer.geotiffToLoad = FAKE_SCALAR_GEOTIFF;
      await previewer.preview();

      expect(previewer.previewLayers[0].defaultColorRamp).toEqual(DEFAULT_COLOR_RAMP);
      expect(previewer.previewLayers[0].colorRampRange).toEqual([-184.48, 607.27]);
    });

    it('publishes no ramp at all for an ordinary COG', async () => {
      const { previewer } = previewFor();
      await previewer.preview();

      expect(previewer.previewLayers[0].defaultColorRamp).toBeUndefined();
      expect(previewer.previewLayers[0].colorRampRange).toBeUndefined();
    });

    it("draws through the scalar pipeline rather than deck.gl-geotiff's own", async () => {
      const { previewer } = previewFor();
      previewer.geotiffToLoad = FAKE_SCALAR_GEOTIFF;
      await previewer.preview();

      const { props } = previewer.overlay.lastLayers[0];
      expect(props.getTileData).toBe(scalarGetTileData);
      expect(props.renderTile).toBeInstanceOf(Function);
    });

    it('leaves getTileData and renderTile unset for an ordinary COG, so its own pipeline is inferred', async () => {
      const { previewer } = previewFor();
      await previewer.preview();

      const { props } = previewer.overlay.lastLayers[0];
      expect(props.getTileData).toBeFalsy();
      expect(props.renderTile).toBeFalsy();
    });

    it('draws in the default ramp until the user chooses one', async () => {
      const { previewer } = previewFor();
      previewer.geotiffToLoad = FAKE_SCALAR_GEOTIFF;
      await previewer.preview();

      expect(previewer.overlay.lastLayers[0].props.updateTriggers).toEqual({ renderTile: [DEFAULT_COLOR_RAMP, -184.48, 607.27] });
    });

    it('changes updateTriggers when the ramp changes, so deck.gl actually redraws it', async () => {
      const { previewer } = previewFor();
      previewer.geotiffToLoad = FAKE_SCALAR_GEOTIFF;
      await previewer.preview();

      previewer.applyLayerState(new Map([['stanford-vq494qx9344-cog', { visible: true, opacity: 0.8, colorRamp: 'magma' }]]));

      expect(previewer.overlay.lastLayers[0].props.updateTriggers).toEqual({ renderTile: ['magma', -184.48, 607.27] });
    });

    it('keeps the COG open and the layer id stable across a ramp change, same as an opacity change', async () => {
      const { previewer } = previewFor();
      previewer.geotiffToLoad = FAKE_SCALAR_GEOTIFF;
      await previewer.preview();

      previewer.applyLayerState(new Map([['stanford-vq494qx9344-cog', { visible: true, opacity: 0.8, colorRamp: 'magma' }]]));

      expect(previewer.opened).toEqual([COG_URL]);
      const ids = previewer.overlay.props.flatMap(p => (p.layers ?? []).map((l: any) => l.id));
      expect(new Set(ids).size).toEqual(1);
    });
  });

  describe("what a COG's values measure", () => {
    const ELEVATION = { name: 'Elevation', unit: 'meters', datum: 'North American Vertical Datum of 1988' };

    const metadataFor = (previewer: TestCogPreviewer) => {
      let answer: (quantity: typeof ELEVATION | undefined) => void = () => {};
      const read = new Promise<typeof ELEVATION | undefined>(resolve => (answer = resolve));
      const resource = previewer['resource'] as CogResource;
      resource.getQuantity = vi.fn(() => read);
      return { answer, resource };
    };

    it('puts it on the layer when it has arrived by the time the layer is drawn', async () => {
      const { previewer } = previewFor();
      previewer.geotiffToLoad = FAKE_SCALAR_GEOTIFF;
      metadataFor(previewer).answer(ELEVATION);
      await previewer.preview();

      expect(previewer.previewLayers[0].quantity).toEqual(ELEVATION);
    });

    it('puts it on the layer once it arrives after the layer is drawn, and says the layer changed', async () => {
      const { previewer } = previewFor();
      previewer.geotiffToLoad = FAKE_SCALAR_GEOTIFF;
      const onLayersChanged = vi.fn();
      previewer.onLayersChanged = onLayersChanged;
      const { answer } = metadataFor(previewer);
      await previewer.preview();
      expect(previewer.previewLayers[0].quantity).toBeUndefined();

      answer(ELEVATION);
      await vi.waitFor(() => expect(onLayersChanged).toHaveBeenCalledTimes(1));
      expect(previewer.previewLayers[0].quantity).toEqual(ELEVATION);
    });

    it('leaves an ordinary COG without one, whatever its metadata says', async () => {
      const { previewer } = previewFor();
      const onLayersChanged = vi.fn();
      previewer.onLayersChanged = onLayersChanged;
      const { answer } = metadataFor(previewer);
      await previewer.preview();
      answer(ELEVATION);
      await Promise.resolve();

      expect(previewer.previewLayers[0].quantity).toBeUndefined();
      expect(onLayersChanged).not.toHaveBeenCalled();
    });

    it('leaves the layer as it is when the metadata says nothing', async () => {
      const { previewer } = previewFor();
      previewer.geotiffToLoad = FAKE_SCALAR_GEOTIFF;
      const onLayersChanged = vi.fn();
      previewer.onLayersChanged = onLayersChanged;
      const { answer } = metadataFor(previewer);
      await previewer.preview();
      answer(undefined);
      await Promise.resolve();

      expect(previewer.previewLayers[0]).not.toHaveProperty('quantity');
      expect(onLayersChanged).not.toHaveBeenCalled();
    });

    it('keeps it across a redraw', async () => {
      const { map, previewer } = previewFor();
      previewer.geotiffToLoad = FAKE_SCALAR_GEOTIFF;
      metadataFor(previewer).answer(ELEVATION);
      await previewer.preview();

      await previewer.clearPreview();
      metadataFor(previewer);
      previewer.attach(map as unknown as MapLibreMap, style);
      await previewer.preview();

      expect(previewer.previewLayers[0].quantity).toEqual(ELEVATION);
    });
  });

  it('decodes through the pool shared with every other COG', () => {
    const { previewer } = previewFor();
    const { previewer: other } = previewFor();

    expect(previewer.pool).toBe(other.pool);
  });

  describe('when the map changes projection', () => {
    it('hands the overlay its layers again, which is what makes it re-read the projection', async () => {
      const { map, previewer } = previewFor();
      await previewer.preview();

      const before = previewer.overlay.props.length;
      map.emit('projectiontransition');

      expect(previewer.overlay.props.length).toEqual(before + 1);
      expect(previewer.overlay.lastLayers).toHaveLength(1);
    });

    it('watches once however many times it is attached', async () => {
      const { map, previewer } = previewFor();
      previewer.attach(map as unknown as MapLibreMap, style);
      await previewer.preview();

      expect(map.listenerCount('projectiontransition')).toEqual(1);
    });

    it('stops watching once the preview is cleared', async () => {
      const { map, previewer } = previewFor();
      await previewer.preview();
      await previewer.clearPreview();

      expect(map.listenerCount('projectiontransition')).toEqual(0);
    });
  });

  describe('saying it is loading', () => {
    const answers = (previewer: TestCogPreviewer, loaded: boolean) => Object.defineProperty(previewer.overlay.lastLayers[0], 'isLoaded', { get: () => loaded, configurable: true });

    const loadingPreview = async () => {
      const { map, previewer } = previewFor();
      const onLoading = vi.fn();
      previewer.onLoading = onLoading;
      await previewer.preview();
      return { map, previewer, onLoading };
    };

    it('says so while the tiles in view are on their way, and says when they are in', async () => {
      const { map, previewer, onLoading } = await loadingPreview();

      answers(previewer, false);
      map.emit('render');
      answers(previewer, true);
      map.emit('render');

      expect(onLoading.mock.calls).toEqual([[true], [false]]);
    });

    it('says each once, however many frames go by', async () => {
      const { map, previewer, onLoading } = await loadingPreview();

      answers(previewer, false);
      map.emit('render');
      map.emit('render');
      map.emit('render');

      expect(onLoading.mock.calls).toEqual([[true]]);
    });

    it('says nothing is loading once the reader switches the layer off', async () => {
      const { map, previewer, onLoading } = await loadingPreview();
      answers(previewer, false);
      map.emit('render');

      previewer.applyLayerState(new Map([['stanford-vq494qx9344-cog', { visible: false, opacity: 0.8 }]]));
      answers(previewer, false);
      map.emit('render');

      expect(onLoading).toHaveBeenLastCalledWith(false);
    });

    it('says it is done when the preview is cleared mid-load, and stops listening', async () => {
      const { map, previewer, onLoading } = await loadingPreview();
      answers(previewer, false);
      map.emit('render');

      await previewer.clearPreview();

      expect(onLoading.mock.calls).toEqual([[true], [false]]);
      expect(map.listenerCount('render')).toEqual(0);
    });

    it('listens once however many times it is attached', async () => {
      const { map, previewer } = previewFor();
      previewer.attach(map as unknown as MapLibreMap, style);
      await previewer.preview();

      expect(map.listenerCount('render')).toEqual(1);
    });
  });

  describe('beforeId', () => {
    it('hands deck.gl the basemap layer to draw underneath', async () => {
      const { map, previewer } = previewFor();
      map.layers.set(defaultBeforeId, { id: defaultBeforeId, type: 'symbol' });
      await previewer.preview();

      expect(previewer.overlay.lastLayers[0].props.beforeId).toEqual(defaultBeforeId);
    });

    it("hands it nothing when the basemap has no layer by that name, so it's drawn on top", async () => {
      const { previewer } = previewFor();
      await previewer.preview();

      expect(previewer.overlay.lastLayers[0].props.beforeId).toBeUndefined();
    });

    it('hands it nothing when told to draw on top', async () => {
      const { map, previewer } = previewFor();
      map.layers.set(defaultBeforeId, { id: defaultBeforeId, type: 'symbol' });
      previewer.beforeId = '';
      await previewer.preview();

      expect(previewer.overlay.lastLayers[0].props.beforeId).toBeUndefined();
    });

    describe('drawn before the basemap has finished loading', () => {
      it('hands the overlay its layer again once the map is idle', async () => {
        const { map, previewer } = previewFor();
        map.styleLoaded = false;
        await previewer.preview();

        const before = previewer.overlay.props.length;
        map.styleLoaded = true;
        map.emit('idle');

        expect(previewer.overlay.props.length).toEqual(before + 1);
        expect(previewer.overlay.lastLayers).toHaveLength(1);
      });

      it('waits once however many times it is drawn', async () => {
        const { map, previewer } = previewFor();
        map.styleLoaded = false;
        await previewer.preview();
        previewer.applyLayerState(new Map([['stanford-vq494qx9344-cog', { visible: true, opacity: 0.5 }]]));
        previewer.applyLayerState(new Map([['stanford-vq494qx9344-cog', { visible: true, opacity: 0.4 }]]));

        expect(map.listenerCount('idle')).toEqual(1);
      });

      it('stops waiting once the preview is cleared', async () => {
        const { map, previewer } = previewFor();
        map.styleLoaded = false;
        await previewer.preview();
        await previewer.clearPreview();

        expect(map.listenerCount('idle')).toEqual(0);
      });
    });

    it("doesn't wait for anything when the basemap has already loaded", async () => {
      const { map, previewer } = previewFor();
      await previewer.preview();

      expect(map.listenerCount('idle')).toEqual(0);
    });
  });

  it('is drawn on the globe everything else is drawn on', () => {
    const { previewer } = previewFor();

    expect(previewer.projection).toEqual('globe');
    expect(new RasterPreviewer(new CogResource('id', COG_URL)).projection).toEqual('globe');
  });

  it('leaves the pitch alone, which it can be drawn under', () => {
    const { previewer } = previewFor();

    expect(previewer.maxPitch).toBeUndefined();
  });

  describe('getBounds', () => {
    it("uses the record's bounding box without waiting on the GeoTIFF header", async () => {
      const declared: LngLatBoundsLike = [
        [-122.2, 37.4],
        [-122.1, 37.5],
      ];
      const { previewer } = previewFor(declared);
      await previewer.preview();

      expect(await previewer.getBounds()).toEqual(declared);
    });

    it("reports the COG's own extent once deck.gl has read its header", async () => {
      const { previewer } = previewFor();
      await previewer.preview();

      previewer.overlay.lastLayers[0].props.onGeoTIFFLoad({}, { geographicBounds: { west: -122.2, south: 37.4, east: -122.1, north: 37.5 } });

      expect(await previewer.getBounds()).toEqual([
        [-122.2, 37.4],
        [-122.1, 37.5],
      ]);
    });

    it("still reports the COG's own extent when the record carried a bounding box", async () => {
      const { previewer } = previewFor([
        [0, 0],
        [1, 1],
      ]);
      await previewer.preview();

      previewer.overlay.lastLayers[0].props.onGeoTIFFLoad({}, { geographicBounds: { west: -122.2, south: 37.4, east: -122.1, north: 37.5 } });

      expect(await previewer.getReportedBounds()).toEqual([
        [-122.2, 37.4],
        [-122.1, 37.5],
      ]);
    });
  });

  describe('a tile that fails', () => {
    let consoleWarn: ReturnType<typeof vi.spyOn>;
    let consoleError: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleWarn.mockRestore();
      consoleError.mockRestore();
    });

    const failTile = (previewer: TestCogPreviewer, error: unknown = new Error('Band-separate images not yet implemented.')) =>
      previewer.overlay.lastLayers[0].props.onTileError(error);

    const drawTile = (previewer: TestCogPreviewer) => previewer.overlay.lastLayers[0].props.onTileLoad({});

    it('fails the preview when nothing has been drawn', async () => {
      const { previewer } = previewFor();
      const reported: unknown[] = [];
      previewer.onError = error => reported.push(error);
      await previewer.preview();

      failTile(previewer);

      expect(reported).toEqual([new Error('Band-separate images not yet implemented.')]);
    });

    it('is left alone once some of the COG is on screen', async () => {
      const { previewer } = previewFor();
      const reported: unknown[] = [];
      previewer.onError = error => reported.push(error);
      await previewer.preview();

      drawTile(previewer);
      failTile(previewer);

      expect(reported).toEqual([]);
    });

    it('ignores an aborted read', async () => {
      const { previewer } = previewFor();
      const reported: unknown[] = [];
      previewer.onError = error => reported.push(error);
      await previewer.preview();

      failTile(previewer, new DOMException('The user aborted a request.', 'AbortError'));

      expect(reported).toEqual([]);
    });

    it('says so when deck.gl draws a tile, which nothing on the map would report', async () => {
      const { previewer } = previewFor();
      let drawn = 0;
      previewer.onDrawn = () => (drawn += 1);
      await previewer.preview();

      drawTile(previewer);

      expect(previewer.reportsDrawing).toBe(true);
      expect(drawn).toBe(1);
    });

    it('says nothing about a tile that failed', async () => {
      const { previewer } = previewFor();
      let drawn = 0;
      previewer.onDrawn = () => (drawn += 1);
      previewer.onError = () => {};
      await previewer.preview();

      failTile(previewer);

      expect(drawn).toBe(0);
    });

    it('fails again after the preview is drawn a second time', async () => {
      const { map, previewer } = previewFor();
      const reported: unknown[] = [];
      previewer.onError = error => reported.push(error);
      await previewer.preview();
      drawTile(previewer);

      previewer.attach(map as unknown as MapLibreMap, style);
      await previewer.preview();
      failTile(previewer);

      expect(reported).toHaveLength(1);
    });
  });

  describe('a tile evicted from the cache', () => {
    const fakeTexture = () => ({
      destroyed: 0,
      destroy() {
        this.destroyed += 1;
      },
    });

    const unload = (previewer: TestCogPreviewer, content: unknown) => previewer.overlay.lastLayers[0].props.onTileUnload({ content });

    const scalarPreview = async () => {
      const { previewer } = previewFor();
      previewer.geotiffToLoad = FAKE_SCALAR_GEOTIFF;
      await previewer.preview();
      return previewer;
    };

    const scalarTile = (texture: unknown, colormapTexture: unknown) => ({ width: 256, height: 256, byteLength: 262144, texture, colormapTexture });

    it("frees the scalar pipeline's upload of the tile", async () => {
      const previewer = await scalarPreview();
      const texture = fakeTexture();

      unload(previewer, scalarTile(texture, fakeTexture()));

      expect(texture.destroyed).toEqual(1);
    });

    it('leaves the colormap alone, which every other tile is still sampling', async () => {
      const previewer = await scalarPreview();
      const colormapTexture = fakeTexture();

      unload(previewer, scalarTile(fakeTexture(), colormapTexture));

      expect(colormapTexture.destroyed).toEqual(0);
    });

    it('has nothing to free for a tile that never finished loading', async () => {
      const previewer = await scalarPreview();

      expect(() => unload(previewer, null)).not.toThrow();
    });
  });

  it('takes its layer off the overlay when cleared', async () => {
    const { previewer } = previewFor();
    await previewer.preview();
    await previewer.clearPreview();

    expect(previewer.overlay.lastLayers).toEqual([]);
    expect(previewer.previewLayers).toEqual([]);
  });
});
