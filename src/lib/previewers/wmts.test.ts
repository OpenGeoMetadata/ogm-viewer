import { describe, it, expect, beforeEach, vi } from '@stencil/vitest';
import type { MapLibreMap } from 'maplibre-gl';

import WmtsPreviewer from './wmts';
import WmtsResource, { type WmtsLayer, type WmtsTime } from '../resources/wmts';
import type { LayerState } from '../layers';
import type { MapLibreStyle } from '../themes/maplibre';
import { parseTime } from '../time';

// Just enough of a MapLibre map to record what the previewer adds
class FakeMap {
  sources = new Map<string, Record<string, unknown>>();
  layers = new Map<string, any>();
  idleListeners: (() => void)[] = [];

  getSource(id: string) {
    return this.sources.get(id);
  }
  addSource(id: string, spec: Record<string, unknown>) {
    // Pointed at other tiles the way a raster source is, and keeping a note of each time it was
    const source: Record<string, unknown> & { reloads: string[][] } = {
      ...spec,
      reloads: [],
      setTiles: (tiles: string[]) => {
        source.tiles = tiles;
        source.reloads.push(tiles);
      },
    };
    this.sources.set(id, source);
  }
  once(event: string, listener: () => void) {
    if (event === 'idle') this.idleListeners.push(listener);
  }
  // Every tile the map was waiting on has arrived
  goIdle() {
    this.idleListeners.splice(0).forEach(listener => listener());
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

const LEGENDS = [
  { url: 'https://one.example.org/legends/lights_H.svg', format: 'image/svg+xml', width: 378, height: 86 },
  { url: 'https://one.example.org/legends/lights_V.svg', format: 'image/svg+xml', width: 135, height: 288 },
];

// A layer served from several tile hosts with a legend, and one on a grid with its own size and
// limits and no legend
const LAYERS: WmtsLayer[] = [
  {
    id: 'lights',
    title: 'Night Lights',
    tileUrls: ['https://one.example.org/lights/{z}/{y}/{x}.png', 'https://two.example.org/lights/{z}/{y}/{x}.png'],
    tileSize: 256,
    minzoom: 0,
    maxzoom: 8,
    legendImages: LEGENDS,
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
  previewer = new WmtsPreviewer(resource).attach(map as unknown as MapLibreMap, style);
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

  // Every one of them, since which applies depends on the map the legend is drawn over
  it("carries each layer's legend pictures to its own row", () => {
    expect(previewer.previewLayers[0].legendImages).toEqual(LEGENDS);
    expect(previewer.previewLayers[1]).not.toHaveProperty('legendImages');
  });

  it('falls back to the identifier when the service published no title', async () => {
    resource.layers = [{ ...LAYERS[0], title: '   ' }];
    previewer = new WmtsPreviewer(resource).attach(map as unknown as MapLibreMap, style);
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

// GIBS's MODIS true color in miniature: daily, with a gap, and its full domain described elsewhere
const TIME: WmtsTime = {
  identifier: 'Time',
  default: '2026-10-01',
  values: ['2026-09-01/2026-09-20/P1D', '2026-09-23/2026-10-01/P1D'],
  templates: ['https://gibs.example.org/MODIS/default/{Time}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpeg'],
  domainsUrl: 'https://gibs.example.org/1.0.0/MODIS/default/GoogleMapsCompatible_Level9/all/all.xml',
};

const MODIS: WmtsLayer = {
  id: 'modis',
  title: 'Corrected Reflectance (True Color)',
  tileUrls: ['https://gibs.example.org/MODIS/default/2026-10-01/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpeg'],
  tileSize: 256,
  minzoom: 0,
  maxzoom: 9,
  time: TIME,
};

const ID = 'night-lights-modis';

// What <ogm-map> hands over when the reader picks a time, and nothing else about the layer
const pick = (time: string) => new Map<string, LayerState>([[ID, { visible: true, opacity: 0.8, time }]]);

const source = () => map.sources.get(ID) as { tiles: string[]; reloads: string[][] };

describe('WmtsPreviewer with a layer that has a choice of times', () => {
  beforeEach(async () => {
    map = new FakeMap();
    resource = new StubWmtsResource('night-lights', 'https://gibs.example.org/1.0.0/WMTSCapabilities.xml', { layerIds: [] });
    resource.layers = [MODIS, LAYERS[1]];
    previewer = new WmtsPreviewer(resource).attach(map as unknown as MapLibreMap, style);
    await previewer.preview();
  });

  it('gives its row the times it offers and the one it starts at', () => {
    const [row, other] = previewer.previewLayers;

    expect(row.defaultTime).toEqual('2026-10-01');
    expect(row.timeDomain?.first).toEqual(parseTime('2026-09-01'));
    expect(row.timeDomain?.last).toEqual(parseTime('2026-10-01'));
    expect(other).not.toHaveProperty('timeDomain');
  });

  it('starts at its default', () => {
    expect(source().tiles).toEqual(MODIS.tileUrls);
  });

  it('draws the time picked, through the templates that can be told it', () => {
    previewer.applyLayerState(pick('2026-09-30'));

    expect(source().tiles).toEqual(['https://gibs.example.org/MODIS/default/2026-09-30/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpeg']);
  });

  // applyLayerState runs on every frame of an opacity drag
  it('leaves the tiles alone when the time asked for is the one being drawn', () => {
    previewer.applyLayerState(pick('2026-10-01'));
    expect(source().reloads).toHaveLength(0);

    previewer.applyLayerState(pick('2026-09-30'));
    previewer.applyLayerState(pick('2026-09-30'));
    expect(source().reloads).toHaveLength(1);
  });

  // MapLibre doesn't cancel the requests a reload replaces, and a tile shows whichever answers last
  it('waits for the tiles of one time before asking for another, and then asks only for the latest', () => {
    previewer.applyLayerState(pick('2026-09-30'));
    previewer.applyLayerState(pick('2026-09-29'));
    previewer.applyLayerState(pick('2026-09-28'));
    expect(source().reloads).toHaveLength(1);

    map.goIdle();
    expect(source().reloads).toHaveLength(2);
    expect(source().tiles[0]).toContain('/2026-09-28/');

    map.goIdle();
    expect(source().reloads).toHaveLength(2);
  });

  it('draws nothing more when the reader comes back to the time being drawn while it waits', () => {
    previewer.applyLayerState(pick('2026-09-30'));
    previewer.applyLayerState(pick('2026-09-29'));
    previewer.applyLayerState(pick('2026-09-30'));

    map.goIdle();
    expect(source().reloads).toHaveLength(1);
  });

  it('keeps every other layer of the service where it was', () => {
    previewer.applyLayerState(pick('2026-09-30'));

    expect(map.sources.get('night-lights-ortho')?.tiles).toEqual(LAYERS[1].tileUrls);
  });

  // A theme change: setStyle takes every source away, and the same previewer draws itself again
  it('starts again at its default when it is drawn into a new style, whatever the last one was waiting on', async () => {
    previewer.applyLayerState(pick('2026-09-30'));
    map.sources.clear();
    map.layers.clear();
    await previewer.preview();
    expect(source().tiles).toEqual(MODIS.tileUrls);

    // The wait that belonged to the source that went is over for good, and holds nothing up
    map.goIdle();
    previewer.applyLayerState(pick('2026-09-28'));
    expect(source().reloads).toHaveLength(1);
    expect(source().tiles[0]).toContain('/2026-09-28/');
  });

  describe('once the reader starts using its control', () => {
    it('reads every time the service has for it, once, and says the row has changed', async () => {
      const fetchTimeValues = vi.spyOn(resource, 'fetchTimeValues').mockResolvedValue(['2000-02-24/2026-09-20/P1D']);
      const changed = vi.fn();
      previewer.onLayersChanged = changed;

      previewer.loadTimeDomain(ID);
      previewer.loadTimeDomain(ID);
      await vi.waitFor(() => expect(changed).toHaveBeenCalled());

      expect(fetchTimeValues).toHaveBeenCalledTimes(1);
      expect(previewer.previewLayers[0].timeDomain?.first).toEqual(parseTime('2000-02-24'));
      // Along with the times the capabilities listed, which can be newer
      expect(previewer.previewLayers[0].timeDomain?.last).toEqual(parseTime('2026-10-01'));
    });

    it('keeps what it read when it is drawn again', async () => {
      vi.spyOn(resource, 'fetchTimeValues').mockResolvedValue(['2000-02-24/2026-09-20/P1D']);
      const changed = vi.fn();
      previewer.onLayersChanged = changed;
      previewer.loadTimeDomain(ID);
      await vi.waitFor(() => expect(changed).toHaveBeenCalled());

      map.sources.clear();
      map.layers.clear();
      await previewer.preview();

      expect(previewer.previewLayers[0].timeDomain?.first).toEqual(parseTime('2000-02-24'));
    });

    it('makes do with the times the capabilities listed when the rest can’t be read', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(resource, 'fetchTimeValues').mockRejectedValue(new Error('Failed to fetch'));
      const changed = vi.fn();
      previewer.onLayersChanged = changed;

      previewer.loadTimeDomain(ID);
      await vi.waitFor(() => expect(warn).toHaveBeenCalled());

      expect(changed).not.toHaveBeenCalled();
      expect(previewer.previewLayers[0].timeDomain?.first).toEqual(parseTime('2026-09-01'));
      warn.mockRestore();
    });

    it('asks for nothing for a layer with no time to choose', () => {
      const fetchTimeValues = vi.spyOn(resource, 'fetchTimeValues');

      previewer.loadTimeDomain('night-lights-ortho');

      expect(fetchTimeValues).not.toHaveBeenCalled();
    });
  });
});
