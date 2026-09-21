import { describe, it, expect, vi, beforeEach, afterEach } from '@stencil/vitest';
import type { LngLatBoundsLike, MapLibreMap } from 'maplibre-gl';

import CogPreviewer from './cog';
import { scalarGetTileData } from '../cog-pipeline';
import RasterPreviewer from './raster';
import CogResource from '../resources/cog';
import { DEFAULT_COLOR_RAMP } from '../colormap';
import type { MapLibreStyle } from '../themes/maplibre';

// Just enough of a MapLibre map to record what the previewer does. setPaintProperty and
// setLayoutProperty both throw: MapLibre never learns this layer's id at all, since deck.gl draws
// through an overlay of its own, so reaching for either would be a bug.
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

  // Enough of MapLibre's event emitter for the projection watch in CogPreviewer. once() is on()
  // here: nothing in these tests removes a map, so the distinction never comes up.
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

// deck.gl's own overlay needs a WebGL context before it will do anything, so this stands in for it
// and records the props the previewer hands over - which is the whole of how a deck layer is drawn.
class FakeOverlay {
  props: { layers?: any[] }[] = [];

  setProps(props: { layers?: any[] }) {
    this.props.push(props);
  }

  get lastLayers() {
    return this.props[this.props.length - 1]?.layers ?? [];
  }
}

// Stands in for the open COG. Every read of it happens inside deck.gl, so the previewer only ever
// hands it over - which is the whole of what these tests check about it.
const FAKE_GEOTIFF = { crs: 'EPSG:4326' };

// A single-band float COG - SampleFormat 3, one sample per pixel - with statistics already on
// record, which is what most GDAL-written COGs carry. Read by isScalarSampleFormat and scalarRange
// (see cog-pipeline.test.ts for both in isolation); statistics being present means scalarRange never
// has to reach for fetchTile, so nothing here needs to answer one.
const FAKE_SCALAR_GEOTIFF = {
  crs: 'EPSG:4326',
  cachedTags: { sampleFormat: [3], samplesPerPixel: 1 },
  gdalMetadata: { bandStatistics: new Map([[1, { min: -184.48, max: 607.27, mean: null, std: null, validPercent: null }]]) },
  overviews: [],
};

// Substitutes the fake overlay for deck.gl's and the fake COG for a real read, leaving everything else
// the real previewer
class TestCogPreviewer extends CogPreviewer {
  overlay = new FakeOverlay();

  get pool() {
    return this.decoderPool;
  }

  opened: string[] = [];
  refusal: Error | undefined;
  // What loadGeoTIFF hands back - FAKE_GEOTIFF unless a test needs a scalar one instead
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

  // Handed a URL, deck.gl opens the COG with a plain fetch that no request transform can reach, which
  // is what left a restricted COG undrawable by this previewer. It gets one already open instead.
  it('hands deck.gl the open COG rather than a URL for it to fetch itself', async () => {
    const { previewer } = previewFor();
    await previewer.preview();

    expect(previewer.overlay.lastLayers[0].props.geotiff).toBe(FAKE_GEOTIFF);
    expect(previewer.opened).toEqual([COG_URL]);
  });

  // The header is read once. Rebuilding the layer for an opacity change must not read it again.
  it('keeps the COG open across a layer rebuild', async () => {
    const { previewer } = previewFor();
    await previewer.preview();

    previewer.applyLayerState(new Map([['stanford-vq494qx9344-cog', { visible: true, opacity: 0.25 }]]));

    expect(previewer.opened).toEqual([COG_URL]);
    expect(previewer.overlay.lastLayers[0].props.geotiff).toBe(FAKE_GEOTIFF);
  });

  // A COG that refuses to be read is a failed preview, so <ogm-preview> can say so - before this it
  // was deck.gl's own problem and only turned up in the console
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

  // deck.gl takes both as layer props; FakeMap throws from either setter, so reaching for MapLibre
  // instead would fail these outright
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

    // An opacity of zero has to stop it being drawn, not just make it invisible
    it('treats a fully faded layer as hidden', async () => {
      const { previewer } = previewFor();
      await previewer.preview();

      previewer.applyLayerState(new Map([['stanford-vq494qx9344-cog', { visible: true, opacity: 0 }]]));

      expect(previewer.overlay.lastLayers[0].props.visible).toBe(false);
    });

    // Same id every time, so deck.gl updates the props in place and keeps the tiles it has decoded
    it('keeps the same layer id so deck.gl updates rather than reloads', async () => {
      const { previewer } = previewFor();
      await previewer.preview();
      previewer.applyLayerState(new Map([['stanford-vq494qx9344-cog', { visible: true, opacity: 0.5 }]]));

      const ids = previewer.overlay.props.flatMap(p => (p.layers ?? []).map((l: any) => l.id));
      expect(new Set(ids).size).toEqual(1);
    });
  });

  // A scalar COG - single-band float or signed-integer data - draws through its own pipeline
  // (src/lib/cog-pipeline.ts) rather than @developmentseed/deck.gl-geotiff's own, which
  // refuses that data outright.
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

    // getTileData and renderTile are unset either way - COGLayer's _parseGeoTIFF checks !this.props.getTileData
    // || !this.props.renderTile to decide whether to infer a render pipeline itself, which either
    // falsy value satisfies. deck.gl's own defaultProps happens to fill the two differently (null
    // for one, plain undefined for the other); both are asserted so a change either way is caught.
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

    // The trap this test guards: drawDeckLayer rebuilds the layer object on every layer-state
    // change, but deck.gl matches it by id and updates props in place rather than re-rendering from
    // scratch - so without naming the ramp as a renderTile dependency, a swatch click would change
    // nothing the user could see.
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

  // Every COG on the page decodes through the same workers: a pool each would put a multiple of the
  // pool size in workers on a results page of overview maps. See src/lib/decoder.ts.
  it('decodes through the pool shared with every other COG', () => {
    const { previewer } = previewFor();
    const { previewer: other } = previewFor();

    expect(previewer.pool).toBe(other.pool);
  });

  // @deck.gl/maplibre picks its view from the map's projection when its props are set and on
  // 'styledata', and setProjection raises neither - only 'projectiontransition'. Left alone, the
  // overlay keeps drawing through the GlobeView it was built with after a reader presses the globe
  // button off, and the COG lands in the wrong place. See CogPreviewer.watchProjection.
  describe('when the map changes projection', () => {
    it('hands the overlay its layers again, which is what makes it re-read the projection', async () => {
      const { map, previewer } = previewFor();
      await previewer.preview();

      const before = previewer.overlay.props.length;
      map.emit('projectiontransition');

      expect(previewer.overlay.props.length).toEqual(before + 1);
      expect(previewer.overlay.lastLayers).toHaveLength(1);
    });

    // A theme change draws this preview again into a rebuilt style document, with no clearPreview
    // between - so attach() runs twice on the same map and must not leave two listeners
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

  // This preview asked for a flat map until deck.gl-raster implemented a globe bounding volume for
  // its tile traversal - see the note on CogPreviewer. Worth asserting rather than leaving to the
  // inherited default: what it turns on is a globe button <ogm-map> would otherwise keep hidden, and
  // the dependency that earned it is pinned to a prerelease something may yet move off.
  it('is drawn on the globe everything else is drawn on', () => {
    const { previewer } = previewFor();

    expect(previewer.projection).toEqual('globe');
    // The same answer MapPreviewer gives every other map preview, RasterPreviewer standing in here
    expect(new RasterPreviewer(new CogResource('id', COG_URL)).projection).toEqual('globe');
  });

  // Only the globe is a problem here. Unlike Allmaps, deck.gl is handed the whole view state and draws
  // a tilted map correctly, so asking for a pitch limit would take away something that works.
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

      // deck.gl calls this back off the GeoTIFF metadata
      previewer.overlay.lastLayers[0].props.onGeoTIFFLoad({}, { geographicBounds: { west: -122.2, south: 37.4, east: -122.1, north: 37.5 } });

      expect(await previewer.getBounds()).toEqual([
        [-122.2, 37.4],
        [-122.1, 37.5],
      ]);
    });
  });

  // deck.gl only finds out a COG can't be drawn once its tiles start arriving, which is after
  // preview() has resolved - so before this the map stayed empty and the reason only reached the
  // console. See https://github.com/OpenGeoMetadata/ogm-viewer/issues/158, where a band-separate COG
  // failed every tile this way.
  describe('a tile that fails', () => {
    // Every route out of a failed tile says so on the console first - warned about when the preview
    // survives it, reported as an error when it doesn't. That's the point of the code under test,
    // not something to read in the output of a passing run.
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

    // One error per prop call, since deck.gl reports each failed tile separately
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

    // A COG can be sparse by design, and a hole in a preview the user can see is not worth replacing
    // that preview with an error
    it('is left alone once some of the COG is on screen', async () => {
      const { previewer } = previewFor();
      const reported: unknown[] = [];
      previewer.onError = error => reported.push(error);
      await previewer.preview();

      drawTile(previewer);
      failTile(previewer);

      expect(reported).toEqual([]);
    });

    // deck.gl drops a cancelled tile before calling back, but a decoder that notices the abort itself
    // can still throw one - and a pan that abandons its reads is not a failed preview
    it('ignores an aborted read', async () => {
      const { previewer } = previewFor();
      const reported: unknown[] = [];
      previewer.onError = error => reported.push(error);
      await previewer.preview();

      failTile(previewer, new DOMException('The user aborted a request.', 'AbortError'));

      expect(reported).toEqual([]);
    });

    // Nothing this preview draws passes through a MapLibre source, so a tile drawn is news only
    // deck.gl has. See MapPreviewer.onDrawn.
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

    // A fresh load attempt starts over: the tiles of the last one are gone from the overlay
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

  // deck.gl caches whatever getTileData returned and evicts it without disposing of anything
  // inside, so every GPU texture the two pipelines upload per tile is this previewer's to free.
  // Without that, panning across a large COG leaves every tile it ever decoded resident on the GPU
  // for the life of the page. See https://github.com/developmentseed/deck.gl-raster/issues/591.
  describe('a tile evicted from the cache', () => {
    // Stands in for a luma.gl texture, recording whether it was freed - which is the whole of what
    // these tests are asking about
    const fakeTexture = () => ({
      destroyed: 0,
      destroy() {
        this.destroyed += 1;
      },
    });

    // deck.gl hands the evicted tile back, decoded data and all, on `content`
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

    // The ramp sprite is uploaded once per Device and shared by every scalar tile on the page - see
    // the colormapTextures WeakMap in src/lib/cog-pipeline.ts. Freeing it along with the first tile
    // evicted would leave every tile still on screen sampling a texture that no longer exists, and
    // the WeakMap would go on handing the dead one to every tile decoded afterwards.
    it('leaves the colormap alone, which every other tile is still sampling', async () => {
      const previewer = await scalarPreview();
      const colormapTexture = fakeTexture();

      unload(previewer, scalarTile(fakeTexture(), colormapTexture));

      expect(colormapTexture.destroyed).toEqual(0);
    });

    // Upstream's own inferRenderPipeline uploads a texture per tile too - two, for a COG carrying a
    // mask - and deck.gl-geotiff destroys neither, so an ordinary COG leaks exactly as a scalar one
    // does. Its palette colormap is not reached from here at all: that one belongs to the render
    // pipeline rather than to any tile.
    it('frees the textures of an ordinary COG, which deck.gl-geotiff does not own either', async () => {
      const { previewer } = previewFor();
      await previewer.preview();
      const texture = fakeTexture();
      const mask = fakeTexture();

      unload(previewer, { width: 256, height: 256, byteLength: 262144, texture, mask });

      expect(texture.destroyed).toEqual(1);
      expect(mask.destroyed).toEqual(1);
    });

    // A COG without one decodes to a tile with no mask at all, which is not a tile half-freed
    it('is untroubled by an ordinary COG that carries no mask', async () => {
      const { previewer } = previewFor();
      await previewer.preview();
      const texture = fakeTexture();

      expect(() => unload(previewer, { width: 256, height: 256, byteLength: 262144, texture })).not.toThrow();
      expect(texture.destroyed).toEqual(1);
    });

    // deck.gl evicts a tile still in flight as readily as a finished one, and one that failed never
    // decoded to anything either - both arrive with nothing to free. This is why the previewer reads
    // `content` rather than the `data` upstream's own example does: `data` answers a Promise while
    // the tile is loading, and reaching through that for a texture would throw from inside deck.gl's
    // cache resize.
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
