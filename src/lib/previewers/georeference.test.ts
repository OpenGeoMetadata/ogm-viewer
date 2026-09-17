import { describe, it, expect, afterEach } from '@stencil/vitest';
// vi from vitest itself rather than from @stencil/vitest, which the other previewer tests take it
// from: vi.mock below is rewritten and hoisted by vitest's own transform, and that only recognizes
// the API when it was imported from vitest. The same object either way - @stencil/vitest re-exports
// it - so nothing else in this file changes.
import { vi } from 'vitest';
import { WarpedMapLayer } from '@allmaps/maplibre';
import type { LngLatBoundsLike, MapLibreMap } from 'maplibre-gl';

import GeoreferencePreviewer from './georeference';
import IIIFManifestResource from '../resources/iiif-manifest';
import type { MapLibreStyle } from '../themes/maplibre';

// Reading pixels out of a thumbnail needs a canvas and a network, neither of which this project's
// node environment has; background-color.test.ts covers what it does with them. What's exercised here
// is everything around it: when it is asked, what the panel is told, and what reaches the layer.
const { backgroundColorOf } = vi.hoisted(() => ({ backgroundColorOf: vi.fn(async () => '#f0ebdc') }));
vi.mock('../background-color', () => ({ backgroundColorOf }));

// Just enough of a MapLibre map to record what the previewer puts on it. Unlike the other previewer
// fakes this one has to accept a layer with no source, since that is what a custom layer is - and it
// refuses a paint property outright, which is what MapLibre does for one. It also carries MapLibre's
// event API, because that is where @allmaps/maplibre refires the events its renderer emits: the map,
// not the layer, is how a layer that paints itself can be heard from.
class FakeMap {
  sources = new Map<string, any>();
  layers = new Map<string, any>();
  layoutProperties: [string, string, unknown][] = [];
  listeners = new Map<string, Set<(event: any) => void>>();

  on(type: string, listener: (event: any) => void) {
    (this.listeners.get(type) ?? this.listeners.set(type, new Set()).get(type)!).add(listener);
    return this;
  }
  off(type: string, listener: (event: any) => void) {
    this.listeners.get(type)?.delete(listener);
    return this;
  }
  fire(type: string, event: unknown = {}) {
    this.listeners.get(type)?.forEach(listener => listener(event));
    return this;
  }

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
    // A custom layer draws itself and names no source; anything else must name one MapLibre holds
    if (layer.type !== 'custom' && !this.sources.has(layer.source)) throw new Error(`No source ${layer.source} for layer ${layer.id}`);
    this.layers.set(layer.id, layer);
  }
  removeLayer(id: string) {
    this.layers.delete(id);
  }
  setLayoutProperty(id: string, name: string, value: unknown) {
    this.layoutProperties.push([id, name, value]);
  }
  setPaintProperty(_id: string, name: string) {
    throw new Error(`MapLibre has no ${name} to set on a custom layer`);
  }
}

const style = { opacity: 0.8 } as MapLibreStyle;

const MANIFEST_URL = 'https://purl.stanford.edu/bb013fz9675/iiif3/manifest';

const annotation = {
  type: 'AnnotationPage',
  items: [{ type: 'Annotation', motivation: 'georeferencing', body: { type: 'FeatureCollection', features: [] } }],
};

// Allmaps only works once it has a WebGL2 context, which a fake map has no way to hand it, so the
// calls the previewer makes on the layer are spied on rather than run. Everything either side of
// them - which layer goes on the map, what the layers panel is told, what opacity reaches the layer
// rather than the style - is the previewer's own and is exercised for real.
// One sheet of a scan, as much of it as detecting a background colour reads
const warpedMapFor = (mapId = 'map-id') =>
  ({
    mapId,
    hasImage: () => true,
    image: { width: 4000, height: 3000 },
    resourceMask: [
      [400, 300],
      [3600, 300],
      [3600, 2700],
      [400, 2700],
    ],
  }) as unknown as ReturnType<WarpedMapLayer['getWarpedMap']>;

const previewFor = async () => {
  const addAnnotation = vi.spyOn(WarpedMapLayer.prototype, 'addGeoreferenceAnnotation').mockReturnValue(['map-id']);
  const setOpacity = vi.spyOn(WarpedMapLayer.prototype, 'setOpacity').mockImplementation(() => {});
  // setMapOptions delegates to this one, so a single spy catches both the whole-layer push and the
  // single-sheet catch-up
  const setMapsOptions = vi.spyOn(WarpedMapLayer.prototype, 'setMapsOptions').mockImplementation(() => {});
  const getWarpedMap = vi.spyOn(WarpedMapLayer.prototype, 'getWarpedMap').mockImplementation(() => warpedMapFor());

  const resource = new IIIFManifestResource('bb013fz9675', MANIFEST_URL);
  vi.spyOn(resource, 'getGeoreferenceAnnotation').mockResolvedValue(annotation as any);

  const map = new FakeMap();
  const previewer = new GeoreferencePreviewer(resource).attach(map as unknown as MapLibreMap, style);

  return { map, previewer, resource, addAnnotation, setOpacity, setMapsOptions, getWarpedMap };
};

// Allmaps refires its renderer's events on the map, tagged with the layer they came from; a tile is
// what tells this preview that a sheet's image information is in hand. See handleFirstTile.
const LAYER_ID = 'bb013fz9675-georeference';
const firstTile = (map: FakeMap, mapIds: string[] = ['map-id'], layerId = LAYER_ID) => map.fire('firstmaptileloaded', { type: 'firstmaptileloaded', layerId, mapIds });

// The detection is a promise chain started from a listener, so a fired event is not finished with
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

const stateFor = (removeBackground: boolean) => new Map([[LAYER_ID, { visible: true, opacity: 0.8, removeBackground }]]);

// What setMapsOptions was handed for one sheet, whichever of its two forms it was called in
const optionsFor = (setMapsOptions: ReturnType<typeof vi.spyOn>, mapId = 'map-id') => {
  const [first, second] = setMapsOptions.mock.calls.at(-1) as [unknown, unknown];
  return typeof first === 'function' ? (first as (id: string) => unknown)(mapId) : second;
};

describe('GeoreferencePreviewer', () => {
  // restoreAllMocks only undoes the spyOn ones; the detection above is a plain vi.fn() whose calls
  // would otherwise pile up across the tests that count them
  afterEach(() => {
    vi.restoreAllMocks();
    backgroundColorOf.mockClear();
  });

  it('puts a warped map layer on the map and no source at all', async () => {
    const { map, previewer } = await previewFor();
    await previewer.preview();

    expect(map.sources.size).toEqual(0);
    expect([...map.layers.keys()]).toEqual(['bb013fz9675-georeference']);
    expect(map.layers.get('bb013fz9675-georeference')).toBeInstanceOf(WarpedMapLayer);
    expect(previewer.sourceIds).toEqual([]);
  });

  it('reports its layer as custom, so nothing tries to style it through the style document', async () => {
    const { previewer } = await previewFor();
    await previewer.preview();

    expect(previewer.previewLayers).toHaveLength(1);
    expect(previewer.previewLayers[0].styleLayers).toEqual([{ id: 'bb013fz9675-georeference', type: 'custom' }]);
  });

  it('hands the annotation to the layer only after the layer is on the map', async () => {
    const { map, previewer, addAnnotation } = await previewFor();

    // Allmaps builds its renderer in the layer's onAdd and throws if handed an annotation first
    addAnnotation.mockImplementation(() => {
      expect(map.layers.has('bb013fz9675-georeference')).toBe(true);
      return ['map-id'];
    });

    await previewer.preview();

    expect(addAnnotation).toHaveBeenCalledWith(annotation);
  });

  // A preview is drawn again from scratch on every basemap swap, and MapLibre's setStyle keeps custom
  // layers rather than clearing them with the rest of the document. So a second draw finds a live
  // layer already under this id - and leaving it there, as a style layer would want, stranded the
  // fresh one without the WebGL context MapLibre only hands out in onAdd. Found in the browser:
  // toggling the theme reported 'Renderer not defined. Add the layer to a map before calling this
  // function.' and lost the preview.
  it('replaces its layer rather than being skipped for the one a basemap swap left behind', async () => {
    const { map, previewer } = await previewFor();
    await previewer.preview();
    const first = map.layers.get('bb013fz9675-georeference');

    await previewer.preview();
    const second = map.layers.get('bb013fz9675-georeference');

    expect(second).not.toBe(first);
    // The one on the map has to be the one the previewer will call setOpacity and getBounds on
    expect(second).toBe((previewer as any).layer);
    expect(map.layers.size).toEqual(1);
  });

  it('names its tab something other than the image preview of the same manifest', async () => {
    const { previewer } = await previewFor();

    expect(previewer.label()).not.toEqual(new IIIFManifestResource('bb013fz9675', MANIFEST_URL).label());
  });

  // Only reachable if the manifest stopped being georeferenced between the tab being built and being
  // opened, since that check is what put this preview on offer at all
  it('fails the preview when the manifest turns out to have no annotation', async () => {
    const { previewer, resource } = await previewFor();
    vi.spyOn(resource, 'getGeoreferenceAnnotation').mockResolvedValue(undefined);

    await expect(previewer.preview()).rejects.toThrow(/no georeference annotation/);
  });

  it('fails the preview when every map in the annotation is unreadable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { previewer, addAnnotation } = await previewFor();
    addAnnotation.mockReturnValue([new Error('unsupported transformation')]);

    await expect(previewer.preview()).rejects.toThrow('unsupported transformation');
    expect(warn).toHaveBeenCalled();
  });

  // A page of annotations can be partly readable, and one bad map is no reason to refuse the rest
  it('still draws when only some of the maps in the annotation are unreadable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { previewer, addAnnotation } = await previewFor();
    addAnnotation.mockReturnValue(['map-id', new Error('unsupported transformation')]);

    await expect(previewer.preview()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  // Allmaps derives its own viewport from the map's centre, bearing and one units-per-pixel scale
  // read off the unprojected viewport corners, which describes a flat map and not a sphere. Right to
  // within a percent at the zooms a scan is read at, out by half again by zoom 3, where the warped
  // map slides off the globe - so this preview asks for the flat map it is really drawn on.
  it('asks for a flat map rather than the globe everything else is drawn on', async () => {
    const { previewer } = await previewFor();

    expect(previewer.projection).toEqual('mercator');
  });

  // That same viewport has no pitch, so a tilted map is the same mistake by another route
  it('asks to be held flat, since Allmaps ignores pitch as well as the globe', async () => {
    const { previewer } = await previewFor();

    expect(previewer.maxPitch).toEqual(0);
  });

  describe('applying layer state', () => {
    it('sends opacity to the layer rather than to a paint property', async () => {
      const { previewer, setOpacity } = await previewFor();
      await previewer.preview();

      // FakeMap throws from setPaintProperty, so reaching for one would fail this outright
      previewer.applyLayerState(new Map([['bb013fz9675-georeference', { visible: true, opacity: 0.25 }]]));

      expect(setOpacity).toHaveBeenCalledWith(0.25);
    });

    // Visibility does go through the style document: MapLibre honours it for a custom layer, short-
    // circuiting before it validates any property the layer doesn't have
    it('still hides the layer through MapLibre, which handles visibility for a custom layer', async () => {
      const { map, previewer } = await previewFor();
      await previewer.preview();

      previewer.applyLayerState(new Map([['bb013fz9675-georeference', { visible: false, opacity: 0.8 }]]));

      expect(map.layoutProperties).toContainEqual(['bb013fz9675-georeference', 'visibility', 'none']);
    });
  });

  describe('removing the background', () => {
    it('works the paper color out when a sheet draws, and tells the panel the row has a control now', async () => {
      const { map, previewer } = await previewFor();
      const onLayersChanged = vi.fn();
      previewer.onLayersChanged = onLayersChanged;
      await previewer.preview();

      // Nothing on offer until a colour is in hand: a scan whose thumbnail can't be read is better
      // off with no toggle than with one that does nothing
      expect(previewer.previewLayers[0].backgroundRemovable).toBe(false);
      expect(onLayersChanged).not.toHaveBeenCalled();

      firstTile(map);
      await settle();

      expect(backgroundColorOf).toHaveBeenCalledWith({ width: 4000, height: 3000 }, warpedMapFor()!.resourceMask);
      expect(previewer.previewLayers[0].backgroundRemovable).toBe(true);
      expect(onLayersChanged).toHaveBeenCalled();
    });

    // Every warped layer on this map reports through the same channel, so the filter that keeps
    // onDrawn honest has to keep this honest too
    it('ignores a tile that belongs to another layer', async () => {
      const { map, previewer } = await previewFor();
      await previewer.preview();

      firstTile(map, ['map-id'], 'some-other-georeference');
      await settle();

      expect(backgroundColorOf).not.toHaveBeenCalled();
      expect(previewer.previewLayers[0].backgroundRemovable).toBe(false);
    });

    // The event arrives again on every redraw, and a thumbnail is a whole request
    it('reads a sheet only once, however often its tiles are reported', async () => {
      const { map, previewer } = await previewFor();
      await previewer.preview();

      firstTile(map);
      firstTile(map);
      await settle();
      firstTile(map);
      await settle();

      expect(backgroundColorOf).toHaveBeenCalledTimes(1);
    });

    it('takes the paper away with the tuning the Allmaps Viewer uses, not the library defaults', async () => {
      const { map, previewer, setMapsOptions } = await previewFor();
      await previewer.preview();
      firstTile(map);
      await settle();

      setMapsOptions.mockClear();
      previewer.applyLayerState(stateFor(true));

      expect(optionsFor(setMapsOptions)).toEqual({ removeColor: true, removeColorColor: '#f0ebdc', removeColorThreshold: 1 / 3, removeColorHardness: 0.1 });
    });

    // Zero threshold is what actually switches the shader's branch off; removeColor alone leaves it
    // computing a distance it then ignores
    it('puts the paper back, threshold and all', async () => {
      const { map, previewer, setMapsOptions } = await previewFor();
      await previewer.preview();
      firstTile(map);
      await settle();

      previewer.applyLayerState(stateFor(true));
      setMapsOptions.mockClear();
      previewer.applyLayerState(stateFor(false));

      expect(optionsFor(setMapsOptions)).toEqual({ removeColor: false, removeColorColor: '#f0ebdc', removeColorThreshold: 0, removeColorHardness: 0.1 });
    });

    // applyLayerState runs on every frame of an opacity drag, and each of these rebuilds per-map
    // uniforms and asks for a render
    it('leaves the layer alone when the toggle itself has not moved', async () => {
      const { map, previewer, setMapsOptions } = await previewFor();
      await previewer.preview();
      firstTile(map);
      await settle();

      previewer.applyLayerState(stateFor(true));
      setMapsOptions.mockClear();

      previewer.applyLayerState(new Map([[LAYER_ID, { visible: true, opacity: 0.6, removeBackground: true }]]));
      previewer.applyLayerState(new Map([[LAYER_ID, { visible: true, opacity: 0.4, removeBackground: true }]]));

      expect(setMapsOptions).not.toHaveBeenCalled();
    });

    // A sheet of a multi-sheet scan can come into view after the reader has already switched the
    // toggle on, and the panel's state won't change again by itself to come back for it
    it('catches up a sheet whose color arrives after the toggle is already on', async () => {
      const { map, previewer, setMapsOptions } = await previewFor();
      await previewer.preview();
      firstTile(map, ['first-sheet']);
      await settle();

      previewer.applyLayerState(stateFor(true));
      setMapsOptions.mockClear();

      firstTile(map, ['second-sheet']);
      await settle();

      expect(setMapsOptions).toHaveBeenCalledWith(['second-sheet'], expect.objectContaining({ removeColor: true, removeColorColor: '#f0ebdc' }), undefined);
    });

    // A basemap swap rebuilds the style document and draws this preview again from scratch. The
    // colours are the same scan's, so they are kept - and the row keeps its control rather than
    // losing it and earning it back a request later.
    it('keeps what it learned across a basemap swap, and re-applies it to the new layer', async () => {
      const { map, previewer, setMapsOptions } = await previewFor();
      await previewer.preview();
      firstTile(map);
      await settle();
      previewer.applyLayerState(stateFor(true));

      await previewer.preview();
      expect(previewer.previewLayers[0].backgroundRemovable).toBe(true);

      setMapsOptions.mockClear();
      previewer.applyLayerState(stateFor(true));

      expect(backgroundColorOf).toHaveBeenCalledTimes(1);
      expect(optionsFor(setMapsOptions)).toMatchObject({ removeColor: true, removeColorColor: '#f0ebdc' });
    });

    it('keeps the preview and offers no toggle when the thumbnail cannot be read', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      backgroundColorOf.mockRejectedValueOnce(new Error('403 Forbidden'));

      const { map, previewer } = await previewFor();
      const onLayersChanged = vi.fn();
      previewer.onLayersChanged = onLayersChanged;
      await previewer.preview();

      firstTile(map);
      await settle();

      expect(previewer.previewLayers[0].backgroundRemovable).toBe(false);
      expect(onLayersChanged).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/background color/i), expect.any(Error));
    });

    // Mid-rebuild the layer is an object MapLibre has not handed a context to yet, and every call on
    // it throws 'Renderer not defined' rather than being ignored
    it('does not reach for a layer the style document no longer holds', async () => {
      const { map, previewer, setMapsOptions } = await previewFor();
      await previewer.preview();
      firstTile(map);
      await settle();

      map.removeLayer(LAYER_ID);
      setMapsOptions.mockClear();
      previewer.applyLayerState(stateFor(true));

      expect(setMapsOptions).not.toHaveBeenCalled();
    });
  });

  describe('getBounds', () => {
    it('prefers the extent Allmaps works out from the control points', async () => {
      vi.spyOn(WarpedMapLayer.prototype, 'getBounds').mockReturnValue([
        [3.4, 51.5],
        [6.4, 52.6],
      ]);
      const { previewer } = await previewFor();
      await previewer.preview();

      expect(await previewer.getBounds()).toEqual([
        [3.4, 51.5],
        [6.4, 52.6],
      ]);
    });

    it("falls back to the record's own bounds when the annotation described nothing drawable", async () => {
      vi.spyOn(WarpedMapLayer.prototype, 'getBounds').mockReturnValue(undefined);
      vi.spyOn(WarpedMapLayer.prototype, 'addGeoreferenceAnnotation').mockReturnValue(['map-id']);
      vi.spyOn(WarpedMapLayer.prototype, 'setOpacity').mockImplementation(() => {});

      const declared: LngLatBoundsLike = [
        [-1, -1],
        [1, 1],
      ];
      const resource = new IIIFManifestResource('bb013fz9675', MANIFEST_URL, declared);
      vi.spyOn(resource, 'getGeoreferenceAnnotation').mockResolvedValue(annotation as any);

      const previewer = new GeoreferencePreviewer(resource).attach(new FakeMap() as unknown as MapLibreMap, style);
      await previewer.preview();

      expect(await previewer.getBounds()).toEqual(declared);
    });
  });

  it('takes its layer back off the map when cleared', async () => {
    const { map, previewer } = await previewFor();
    await previewer.preview();
    await previewer.clearPreview();

    expect(map.layers.size).toEqual(0);
    expect(previewer.previewLayers).toEqual([]);
  });

  // Nothing this preview draws passes through a MapLibre source, so whoever is waiting to hear that
  // it is really on the map can only hear it from here. See MapPreviewer.onDrawn.
  describe('reporting its own drawing', () => {
    const FIRST_TILE = 'firstmaptileloaded';

    it('answers for its own drawing rather than being watched through the map', async () => {
      const { previewer } = await previewFor();
      expect(previewer.reportsDrawing).toBe(true);
    });

    it("says so when Allmaps reports the scan's first tile", async () => {
      const { map, previewer } = await previewFor();
      let drawn = 0;
      previewer.onDrawn = () => (drawn += 1);
      await previewer.preview();

      map.fire(FIRST_TILE, { layerId: 'bb013fz9675-georeference' });

      expect(drawn).toBe(1);
    });

    // Every warped layer on one map reports down the same channel, so the news has to be checked
    // against the layer it is about
    it('ignores a tile drawn by another warped layer on the same map', async () => {
      const { map, previewer } = await previewFor();
      let drawn = 0;
      previewer.onDrawn = () => (drawn += 1);
      await previewer.preview();

      map.fire(FIRST_TILE, { layerId: 'some-other-scan-georeference' });

      expect(drawn).toBe(0);
    });

    // A theme change draws the same preview again into a rebuilt style document with no clearPreview
    // between, so the listener has to be replaced rather than added to
    it('reports once per tile after being drawn a second time', async () => {
      const { map, previewer } = await previewFor();
      let drawn = 0;
      previewer.onDrawn = () => (drawn += 1);
      await previewer.preview();
      await previewer.preview();

      map.fire(FIRST_TILE, { layerId: 'bb013fz9675-georeference' });

      expect(drawn).toBe(1);
    });

    it('stops listening once the preview is cleared', async () => {
      const { map, previewer } = await previewFor();
      let drawn = 0;
      previewer.onDrawn = () => (drawn += 1);
      await previewer.preview();
      await previewer.clearPreview();

      map.fire(FIRST_TILE, { layerId: 'bb013fz9675-georeference' });

      expect(drawn).toBe(0);
    });
  });
});
