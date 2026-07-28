import { describe, it, expect, beforeEach } from '@stencil/vitest';

import WmtsPreviewer from './wmts';
import WmtsResource, { type WmtsLayer } from '../resources/wmts';
import type { MapLibreStyle } from '../themes/maplibre';

// Just enough of a MapLibre map to record what the previewer adds
class FakeMap {
  sources = new Map<string, Record<string, unknown>>();
  layers = new Map<string, any>();

  getSource(id: string) {
    return this.sources.get(id);
  }
  addSource(id: string, spec: Record<string, unknown>) {
    this.sources.set(id, spec);
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
  setPaintProperty(id: string, name: string, value: unknown) {
    // MapLibre refuses to style a layer the current style doesn't hold
    const layer = this.layers.get(id);
    if (!layer) throw new Error(`No layer ${id} to paint`);
    layer.paint = { ...layer.paint, [name]: value };
  }
  setLayoutProperty(id: string, name: string, value: unknown) {
    const layer = this.layers.get(id);
    if (!layer) throw new Error(`No layer ${id} to lay out`);
    layer.layout = { ...layer.layout, [name]: value };
  }
}

// Reading the capabilities document is the resource's job and is tested there
class StubWmtsResource extends WmtsResource {
  layers: WmtsLayer[] = [];

  async getLayers() {
    return this.layers;
  }
}

// The previewer only reads the opacity
const style = { opacity: 0.8 } as MapLibreStyle;

// A layer served from several tile hosts, and one on a grid with its own size and limits
const LAYERS: WmtsLayer[] = [
  {
    id: 'lights',
    title: 'Night Lights',
    tileUrls: ['https://one.example.org/lights/{z}/{y}/{x}.png', 'https://two.example.org/lights/{z}/{y}/{x}.png'],
    tileSize: 256,
    minzoom: 0,
    maxzoom: 8,
  },
  {
    id: 'ortho',
    title: 'Orthophoto',
    tileUrls: ['https://one.example.org/ortho/{z}/{y}/{x}.jpeg'],
    tileSize: 512,
    minzoom: 5,
    maxzoom: 20,
    bounds: [16.17, 48.1, 16.58, 48.33],
  },
];

let map: FakeMap;
let resource: StubWmtsResource;
let previewer: WmtsPreviewer;

beforeEach(async () => {
  map = new FakeMap();
  resource = new StubWmtsResource('night-lights', 'https://example.org/wmts/1.0.0/WMTSCapabilities.xml', { layerIds: [] });
  resource.layers = LAYERS;
  previewer = new WmtsPreviewer(resource, map as unknown as maplibregl.Map, style);
  await previewer.preview();
});

describe('WmtsPreviewer#previewLayers', () => {
  // The service writes <ows:Title> for people to read; its identifier is only an address
  it('names each row from the title the service published', () => {
    expect(previewer.previewLayers.map(layer => layer.title)).toEqual(['Night Lights', 'Orthophoto']);
  });

  it('gives each layer of the service its own row', () => {
    expect(previewer.previewLayers.map(layer => layer.id)).toEqual(['night-lights-lights', 'night-lights-ortho']);
    expect(previewer.previewLayers.map(layer => layer.styleLayers.map(styleLayer => styleLayer.id))).toEqual([['night-lights-lights'], ['night-lights-ortho']]);
    expect(previewer.previewLayers.every(layer => layer.defaultOpacity === 0.8)).toBe(true);
  });

  it('falls back to the identifier when the service published no title', async () => {
    resource.layers = [{ ...LAYERS[0], title: '   ' }];
    previewer = new WmtsPreviewer(resource, map as unknown as maplibregl.Map, style);
    await previewer.preview();

    expect(previewer.previewLayers.map(layer => layer.title)).toEqual(['lights']);
  });

  it('leaves the other layers of the service alone when one row changes', () => {
    previewer.applyLayerState(new Map([['night-lights-lights', { visible: false, opacity: 0.5 }]]));

    expect(map.layers.get('night-lights-lights')?.layout.visibility).toEqual('none');
    expect(map.layers.get('night-lights-ortho')?.layout.visibility).toEqual('visible');
    expect(map.layers.get('night-lights-ortho')?.paint['raster-opacity']).toEqual(0.8);
    expect(previewer.visibleLayerIds).toEqual(['night-lights-ortho']);
  });
});

describe('WmtsPreviewer#preview', () => {
  it('adds a source and a layer for each layer of the service', () => {
    expect([...map.sources.keys()]).toEqual(['night-lights-lights', 'night-lights-ortho']);
    expect([...map.layers.keys()]).toEqual(['night-lights-lights', 'night-lights-ortho']);
    expect(map.layers.get('night-lights-ortho')?.source).toEqual('night-lights-ortho');
  });

  it('keeps every tile host the service offers', () => {
    expect(map.sources.get('night-lights-lights')?.tiles).toEqual(LAYERS[0].tileUrls);
  });

  it('draws the tiles as XYZ rasters', () => {
    const source = map.sources.get('night-lights-lights');
    expect(source?.type).toEqual('raster');
    expect(source?.scheme).toEqual('xyz');
  });

  it('carries the tile size of the grid rather than letting MapLibre default it to 512', () => {
    expect(map.sources.get('night-lights-lights')?.tileSize).toEqual(256);
    expect(map.sources.get('night-lights-ortho')?.tileSize).toEqual(512);
  });

  it('bounds the source to the zooms the grid defines', () => {
    // Without these MapLibre keeps asking past the end of the grid instead of overzooming
    // the deepest level it has
    expect(map.sources.get('night-lights-lights')?.maxzoom).toEqual(8);
    expect(map.sources.get('night-lights-ortho')?.minzoom).toEqual(5);
    expect(map.sources.get('night-lights-ortho')?.maxzoom).toEqual(20);
  });

  it('bounds the source to the layer extent, and omits the key when there is none', () => {
    // MapLibre validates the sources it's handed, so an absent extent has to be absent rather
    // than undefined
    expect(map.sources.get('night-lights-ortho')?.bounds).toEqual([16.17, 48.1, 16.58, 48.33]);
    expect(map.sources.get('night-lights-lights')).not.toHaveProperty('bounds');
  });
});

describe('WmtsPreviewer#clearPreview', () => {
  it('removes every source and layer it added', async () => {
    await previewer.clearPreview();

    expect(map.sources.size).toEqual(0);
    expect(map.layers.size).toEqual(0);
    expect(previewer.layerIds).toEqual([]);
  });
});
