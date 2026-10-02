import { describe, it, expect, beforeEach, vi } from '@stencil/vitest';
import type { MapLibreMap } from 'maplibre-gl';

import XyzPreviewer from './xyz';
import TmsResource from '../resources/tms';
import XyzResource from '../resources/xyz';
import type { MapLibreStyle } from '../themes/maplibre';

// Just enough of a MapLibre map to record what the previewer adds, and to hand back the source it
// added as the live object MapLibre would - one the previewer can write a maxzoom to - along with
// the request to look at that source's tiles again
class FakeMap {
  sources = new Map<string, Record<string, unknown>>();
  layers = new Map<string, any>();
  _update = vi.fn();

  getSource(id: string) {
    return this.sources.get(id);
  }
  addSource(id: string, spec: Record<string, unknown>) {
    this.sources.set(id, { ...spec });
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
}

// The previewer only reads the opacity
const style = { opacity: 0.8 } as MapLibreStyle;

// NASA GIBS serves this layer down to zoom 7 and answers anything deeper with a 400
const TEMPLATE = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GHRSST_L4_MUR_Sea_Surface_Temperature/default/default/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png';
const SOURCE = 'ghrsst-xyz';

let map: FakeMap;
let previewer: XyzPreviewer;

beforeEach(async () => {
  map = new FakeMap();
  previewer = new XyzPreviewer(new XyzResource('ghrsst', TEMPLATE)).attach(map as unknown as MapLibreMap, style);
  await previewer.preview();
});

const maxzoom = () => map.sources.get(SOURCE)?.maxzoom;

describe('XyzPreviewer#preview', () => {
  it('draws the template as an XYZ raster', () => {
    expect(map.sources.get(SOURCE)).toMatchObject({ type: 'raster', tiles: [TEMPLATE], scheme: 'xyz', tileSize: 256 });
  });

  // Nothing says how deep the tiles go until one fails, and MapLibre validates the sources it's
  // handed, so an unknown depth has to be absent rather than undefined
  it('sets no depth of its own before it has learned one', () => {
    expect(map.sources.get(SOURCE)).not.toHaveProperty('maxzoom');
  });
});

describe('XyzPreviewer#absorbTileError', () => {
  it('reports the first tile of a service that never sends one', () => {
    expect(previewer.absorbTileError(SOURCE, 3)).toBe(false);
    expect(maxzoom()).toBeUndefined();
  });

  it('takes a tile failing past the deepest zoom that has drawn for the bottom of the pyramid', () => {
    previewer.tileLoaded(SOURCE, 7);

    expect(previewer.absorbTileError(SOURCE, 8)).toBe(true);
    // Held where it last drew, which has MapLibre stretch those tiles rather than ask past them
    expect(maxzoom()).toEqual(7);
  });

  // A failed tile doesn't make MapLibre work out which tiles the view needs again, the way a 404
  // does, so a map that has stopped moving would otherwise keep asking for the tiles that failed
  it('has the map look at the source again once it is held', () => {
    previewer.tileLoaded(SOURCE, 7);
    previewer.absorbTileError(SOURCE, 8);

    expect(map._update).toHaveBeenCalledTimes(1);
  });

  it('still reports a failure at a zoom that has drawn, which is a hole rather than the bottom', () => {
    previewer.tileLoaded(SOURCE, 7);

    expect(previewer.absorbTileError(SOURCE, 7)).toBe(false);
    expect(previewer.absorbTileError(SOURCE, 5)).toBe(false);
    expect(maxzoom()).toBeUndefined();
  });

  // A camera sent several levels in at once can leave the deepest zoom that drew well short of the
  // bottom; held there, the layer would stay blurrier than its service draws it
  it('comes back up one level per failure, rather than straight to the deepest that drew', () => {
    previewer.tileLoaded(SOURCE, 3);

    previewer.absorbTileError(SOURCE, 10);
    expect(maxzoom()).toEqual(9);
    previewer.absorbTileError(SOURCE, 9);
    previewer.absorbTileError(SOURCE, 8);
    expect(maxzoom()).toEqual(7);

    previewer.tileLoaded(SOURCE, 7);
    expect(previewer.absorbTileError(SOURCE, 7)).toBe(false);
  });

  // Tiles asked for before the hold went on can still fail after it, deeper than it
  it('keeps the hold where it is for a failure deeper than one already learned', () => {
    previewer.tileLoaded(SOURCE, 5);
    previewer.absorbTileError(SOURCE, 8);
    map._update.mockClear();

    expect(previewer.absorbTileError(SOURCE, 10)).toBe(true);
    expect(maxzoom()).toEqual(7);
    expect(map._update).not.toHaveBeenCalled();
  });

  it('learns nothing from another source’s tiles', () => {
    previewer.tileLoaded('basemap', 12);

    expect(previewer.absorbTileError(SOURCE, 8)).toBe(false);
    expect(previewer.absorbTileError('basemap', 13)).toBe(false);
  });
});

// A theme change draws the same preview again into a rebuilt style document, with no source on it
describe('XyzPreviewer drawn again', () => {
  beforeEach(async () => {
    previewer.tileLoaded(SOURCE, 7);
    previewer.absorbTileError(SOURCE, 8);

    map = new FakeMap();
    previewer.attach(map as unknown as MapLibreMap, style);
    await previewer.preview();
  });

  it('starts out held to the depth it learned', () => {
    expect(maxzoom()).toEqual(7);
  });

  // Nothing has drawn in the new document yet, which a service with no tiles at all looks like too
  it('still knows a tile past the bottom for what it is', () => {
    expect(previewer.absorbTileError(SOURCE, 9)).toBe(true);
  });
});

describe('XyzPreviewer for a TMS reference', () => {
  it('learns the depth of its own source', async () => {
    const tmsMap = new FakeMap();
    const tms = new XyzPreviewer(new TmsResource('ghrsst', TEMPLATE)).attach(tmsMap as unknown as MapLibreMap, style);
    await tms.preview();

    tms.tileLoaded('ghrsst-tms', 7);

    expect(tms.absorbTileError('ghrsst-tms', 8)).toBe(true);
    expect(tmsMap.sources.get('ghrsst-tms')).toMatchObject({ scheme: 'tms', maxzoom: 7 });
  });
});
