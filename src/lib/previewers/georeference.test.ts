import { describe, it, expect, vi, afterEach } from '@stencil/vitest';
import { WarpedMapLayer } from '@allmaps/maplibre';

import GeoreferencePreviewer from './georeference';
import IIIFManifestResource from '../resources/iiif-manifest';
import type { MapLibreStyle } from '../themes/maplibre';

// Just enough of a MapLibre map to record what the previewer puts on it. Unlike the other previewer
// fakes this one has to accept a layer with no source, since that is what a custom layer is - and it
// refuses a paint property outright, which is what MapLibre does for one.
class FakeMap {
  sources = new Map<string, any>();
  layers = new Map<string, any>();
  layoutProperties: [string, string, unknown][] = [];

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
const previewFor = async () => {
  const addAnnotation = vi.spyOn(WarpedMapLayer.prototype, 'addGeoreferenceAnnotation').mockReturnValue(['map-id']);
  const setOpacity = vi.spyOn(WarpedMapLayer.prototype, 'setOpacity').mockImplementation(() => {});

  const resource = new IIIFManifestResource('bb013fz9675', MANIFEST_URL);
  vi.spyOn(resource, 'getGeoreferenceAnnotation').mockResolvedValue(annotation as any);

  const map = new FakeMap();
  const previewer = new GeoreferencePreviewer(resource).attach(map as unknown as maplibregl.Map, style);

  return { map, previewer, resource, addAnnotation, setOpacity };
};

describe('GeoreferencePreviewer', () => {
  afterEach(() => vi.restoreAllMocks());

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

      const declared: maplibregl.LngLatBoundsLike = [
        [-1, -1],
        [1, 1],
      ];
      const resource = new IIIFManifestResource('bb013fz9675', MANIFEST_URL, declared);
      vi.spyOn(resource, 'getGeoreferenceAnnotation').mockResolvedValue(annotation as any);

      const previewer = new GeoreferencePreviewer(resource).attach(new FakeMap() as unknown as maplibregl.Map, style);
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
});
