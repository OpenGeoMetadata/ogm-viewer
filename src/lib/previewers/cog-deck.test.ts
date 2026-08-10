import { describe, it, expect } from '@stencil/vitest';

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

// Substitutes the fake overlay for deck.gl's, leaving everything else the real previewer
class TestDeckCogPreviewer extends DeckCogPreviewer {
  overlay = new FakeOverlay();

  protected getDeckOverlay() {
    return this.overlay as never;
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

  // getMapLibreSourceUrl() prefixes the cog:// scheme that maplibre-cog-protocol registers, and
  // deck.gl's GeoTIFF loader can't open a URL carrying it
  it('hands deck.gl the bare URL rather than the cog:// one the protocol path needs', async () => {
    const { previewer } = previewFor();
    await previewer.preview();

    expect(previewer.overlay.lastLayers[0].props.geotiff).toEqual(COG_URL);
    // The scheme the other COG previewer wants, which this one must not be handed
    expect(new CogResource('stanford-vq494qx9344', COG_URL).getMapLibreSourceUrl()).toEqual(`cog://${COG_URL}`);
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

  it('takes its layer off the overlay when cleared', async () => {
    const { previewer } = previewFor();
    await previewer.preview();
    await previewer.clearPreview();

    expect(previewer.overlay.lastLayers).toEqual([]);
    expect(previewer.previewLayers).toEqual([]);
  });
});
