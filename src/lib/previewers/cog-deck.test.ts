import { describe, it, expect, vi, beforeEach, afterEach } from '@stencil/vitest';

import DeckCogPreviewer from './cog-deck';
import CogPreviewer from './cog';
import CogResource from '../resources/cog';
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

// Substitutes the fake overlay for deck.gl's and the fake COG for a real read, leaving everything else
// the real previewer
class TestDeckCogPreviewer extends DeckCogPreviewer {
  overlay = new FakeOverlay();
  opened: string[] = [];
  refusal: Error | undefined;

  protected getDeckOverlay() {
    return this.overlay as never;
  }

  protected async loadGeoTIFF() {
    if (this.refusal) throw this.refusal;
    this.opened.push(this.resource.url);
    return FAKE_GEOTIFF as never;
  }
}

const style = { opacity: 0.8 } as MapLibreStyle;

const COG_URL = 'https://example.com/scan.tif';

const previewFor = (bounds?: maplibregl.LngLatBoundsLike) => {
  const map = new FakeMap();
  const previewer = new TestDeckCogPreviewer(new CogResource('stanford-vq494qx9344', COG_URL, bounds)).attach(map as unknown as maplibregl.Map, style);
  return { map, previewer };
};

describe('DeckCogPreviewer', () => {
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
    // And never the cog:// scheme the other COG previewer wants, which deck.gl's loader cannot read
    expect(new CogResource('stanford-vq494qx9344', COG_URL).getMapLibreSourceUrl()).toEqual(`cog://${COG_URL}`);
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

  // deck.gl's TileLayer has no getBoundingVolume for a globe view and logs an error for every frame
  // it tries to cull against one, so this preview asks for the flat map instead
  it('asks for a flat map rather than the globe everything else is drawn on', () => {
    const { previewer } = previewFor();

    expect(previewer.projection).toEqual('mercator');
    expect(new CogPreviewer(new CogResource('id', COG_URL)).projection).toEqual('globe');
  });

  // Only the globe is a problem here. Unlike Allmaps, deck.gl is handed the whole view state and draws
  // a tilted map correctly, so asking for a pitch limit would take away something that works.
  it('leaves the pitch alone, which it can be drawn under', () => {
    const { previewer } = previewFor();

    expect(previewer.maxPitch).toBeUndefined();
  });

  describe('getBounds', () => {
    it("uses the record's bounding box without waiting on the GeoTIFF header", async () => {
      const declared: maplibregl.LngLatBoundsLike = [
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
    const failTile = (previewer: TestDeckCogPreviewer, error: unknown = new Error('Band-separate images not yet implemented.')) =>
      previewer.overlay.lastLayers[0].props.onTileError(error);

    const drawTile = (previewer: TestDeckCogPreviewer) => previewer.overlay.lastLayers[0].props.onTileLoad({});

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

    // A fresh load attempt starts over: the tiles of the last one are gone from the overlay
    it('fails again after the preview is drawn a second time', async () => {
      const { map, previewer } = previewFor();
      const reported: unknown[] = [];
      previewer.onError = error => reported.push(error);
      await previewer.preview();
      drawTile(previewer);

      previewer.attach(map as unknown as maplibregl.Map, style);
      await previewer.preview();
      failTile(previewer);

      expect(reported).toHaveLength(1);
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
