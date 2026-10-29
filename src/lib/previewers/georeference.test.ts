import { describe, it, expect, afterEach } from '@stencil/vitest';
import { vi } from 'vitest';
import { WarpedMapLayer } from '@allmaps/maplibre';
import type { LngLatBoundsLike, MapLibreMap } from 'maplibre-gl';

import GeoreferencePreviewer from './georeference';
import IIIFManifestResource from '../resources/iiif-manifest';
import type { MapLibreStyle } from '../themes/maplibre';

const { backgroundColorOf } = vi.hoisted(() => ({ backgroundColorOf: vi.fn(async () => '#f0ebdc') }));
vi.mock('../background-color', () => ({ backgroundColorOf }));

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

const added = (mapId = 'map-id', index = 0) => ({ ok: true as const, mapId, index });
const failed = (message: string, index = 0) => ({ ok: false as const, error: new Error(message), index });

const previewFor = async () => {
  const addAnnotation = vi.spyOn(WarpedMapLayer.prototype, 'addGeoreferenceAnnotation').mockReturnValue([added()]);
  const setOpacity = vi.spyOn(WarpedMapLayer.prototype, 'setOpacity').mockImplementation(() => {});
  const setMapsOptions = vi.spyOn(WarpedMapLayer.prototype, 'setMapsOptions').mockImplementation(() => {});
  const getWarpedMap = vi.spyOn(WarpedMapLayer.prototype, 'getWarpedMap').mockImplementation(() => warpedMapFor());

  const resource = new IIIFManifestResource('bb013fz9675', MANIFEST_URL);
  vi.spyOn(resource, 'getGeoreferenceAnnotation').mockResolvedValue(annotation as any);

  const map = new FakeMap();
  const previewer = new GeoreferencePreviewer(resource).attach(map as unknown as MapLibreMap, style);

  return { map, previewer, resource, addAnnotation, setOpacity, setMapsOptions, getWarpedMap };
};

const LAYER_ID = 'bb013fz9675-georeference';
const firstTile = (map: FakeMap, mapIds: string[] = ['map-id'], layerId = LAYER_ID) => map.fire('firstmaptileloaded', { type: 'firstmaptileloaded', layerId, mapIds });

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

const stateFor = (removeBackground: boolean) => new Map([[LAYER_ID, { visible: true, opacity: 0.8, removeBackground }]]);

const optionsFor = (setMapsOptions: ReturnType<typeof vi.spyOn>, mapId = 'map-id') => {
  const [first, second] = setMapsOptions.mock.calls.at(-1) as [unknown, unknown];
  return typeof first === 'function' ? (first as (id: string) => unknown)(mapId) : second;
};

describe('GeoreferencePreviewer', () => {
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

    addAnnotation.mockImplementation(() => {
      expect(map.layers.has('bb013fz9675-georeference')).toBe(true);
      return [added()];
    });

    await previewer.preview();

    expect(addAnnotation).toHaveBeenCalledWith(annotation);
  });

  it('replaces its layer rather than being skipped for the one a basemap swap left behind', async () => {
    const { map, previewer } = await previewFor();
    await previewer.preview();
    const first = map.layers.get('bb013fz9675-georeference');

    await previewer.preview();
    const second = map.layers.get('bb013fz9675-georeference');

    expect(second).not.toBe(first);
    expect(second).toBe((previewer as any).layer);
    expect(map.layers.size).toEqual(1);
  });

  it('names its tab something other than the image preview of the same manifest', async () => {
    const { previewer } = await previewFor();

    expect(previewer.label()).not.toEqual(new IIIFManifestResource('bb013fz9675', MANIFEST_URL).label());
  });

  it('fails the preview when the manifest turns out to have no annotation', async () => {
    const { previewer, resource } = await previewFor();
    vi.spyOn(resource, 'getGeoreferenceAnnotation').mockResolvedValue(undefined);

    await expect(previewer.preview()).rejects.toThrow(/no georeference annotation/);
  });

  it('fails the preview when every map in the annotation is unreadable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { previewer, addAnnotation } = await previewFor();
    addAnnotation.mockReturnValue([failed('unsupported transformation')]);

    await expect(previewer.preview()).rejects.toThrow('unsupported transformation');
    expect(warn).toHaveBeenCalled();
  });

  it('still draws when only some of the maps in the annotation are unreadable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { previewer, addAnnotation } = await previewFor();
    addAnnotation.mockReturnValue([added(), failed('unsupported transformation', 1)]);

    await expect(previewer.preview()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it('asks for a flat map rather than the globe everything else is drawn on', async () => {
    const { previewer } = await previewFor();

    expect(previewer.projection).toEqual('mercator');
  });

  it('asks to be held flat, since Allmaps ignores pitch as well as the globe', async () => {
    const { previewer } = await previewFor();

    expect(previewer.maxPitch).toEqual(0);
  });

  describe('applying layer state', () => {
    it('sends opacity to the layer rather than to a paint property', async () => {
      const { previewer, setOpacity } = await previewFor();
      await previewer.preview();

      previewer.applyLayerState(new Map([['bb013fz9675-georeference', { visible: true, opacity: 0.25 }]]));

      expect(setOpacity).toHaveBeenCalledWith(0.25);
    });

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

      expect(previewer.previewLayers[0].backgroundRemovable).toBe(false);
      expect(onLayersChanged).not.toHaveBeenCalled();

      firstTile(map);
      await settle();

      expect(backgroundColorOf).toHaveBeenCalledWith({ width: 4000, height: 3000 }, warpedMapFor()!.resourceMask);
      expect(previewer.previewLayers[0].backgroundRemovable).toBe(true);
      expect(onLayersChanged).toHaveBeenCalled();
    });

    it('ignores a tile that belongs to another layer', async () => {
      const { map, previewer } = await previewFor();
      await previewer.preview();

      firstTile(map, ['map-id'], 'some-other-georeference');
      await settle();

      expect(backgroundColorOf).not.toHaveBeenCalled();
      expect(previewer.previewLayers[0].backgroundRemovable).toBe(false);
    });

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
      vi.spyOn(WarpedMapLayer.prototype, 'addGeoreferenceAnnotation').mockReturnValue([added()]);
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

    it('ignores a tile drawn by another warped layer on the same map', async () => {
      const { map, previewer } = await previewFor();
      let drawn = 0;
      previewer.onDrawn = () => (drawn += 1);
      await previewer.preview();

      map.fire(FIRST_TILE, { layerId: 'some-other-scan-georeference' });

      expect(drawn).toBe(0);
    });

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
