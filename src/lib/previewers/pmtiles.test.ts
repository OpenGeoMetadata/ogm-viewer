import { describe, it, expect } from '@stencil/vitest';

import PMTilesRasterPreviewer from './pmtiles-raster';
import PMTilesResource from '../resources/pmtiles';
import type { MapLibreStyle } from '../themes/maplibre';

// Just enough of a MapLibre map to record what the previewer adds
class FakeMap {
  sources = new Map<string, any>();
  layers = new Map<string, any>();

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
    // MapLibre refuses a layer whose source hasn't been added yet
    if (!this.sources.has(layer.source)) throw new Error(`No source ${layer.source} for layer ${layer.id}`);
    this.layers.set(layer.id, layer);
  }
  removeLayer(id: string) {
    this.layers.delete(id);
  }
}

// The previewer only reads the opacity
const style = { opacity: 0.8 } as MapLibreStyle;

const PMTILES_URL = 'https://example.com/tiles.pmtiles';

// Nothing here reads the archive: the source is built from the URL alone, and the header is only
// touched for bounds
const preview = async () => {
  const map = new FakeMap();
  const previewer = new PMTilesRasterPreviewer(new PMTilesResource('princeton-fk4544658v', PMTILES_URL), map as unknown as maplibregl.Map, style);
  await previewer.preview();
  return { map, previewer };
};

describe('PMTilesRasterPreviewer#preview', () => {
  it('hands MapLibre the URL behind the pmtiles:// protocol', async () => {
    const { map, previewer } = await preview();
    const source = map.sources.get('princeton-fk4544658v-pmtiles');

    expect(source.type).toEqual('raster');
    expect(source.url).toEqual(`pmtiles://${PMTILES_URL}`);
    expect(previewer.sourceIds).toEqual(['princeton-fk4544658v-pmtiles']);
  });

  it('draws its raster layer from the source it added', async () => {
    const { map, previewer } = await preview();

    // A layer pointing at any other ID would be dropped by MapLibre, drawing nothing
    expect([...map.layers.values()].every(layer => map.sources.has(layer.source))).toBe(true);
    expect([...map.layers.keys()]).toEqual(['princeton-fk4544658v-pmtiles']);
    expect(previewer.layerIds).toEqual(['princeton-fk4544658v-pmtiles']);
  });

  it('removes what it added when cleared', async () => {
    const { map, previewer } = await preview();
    await previewer.clearPreview();

    expect(map.sources.size).toEqual(0);
    expect(map.layers.size).toEqual(0);
  });
});
