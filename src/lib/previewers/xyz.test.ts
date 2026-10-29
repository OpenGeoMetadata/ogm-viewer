import { describe, it, expect, beforeEach, vi } from '@stencil/vitest';
import type { MapLibreMap } from 'maplibre-gl';

import XyzPreviewer from './xyz';
import TmsResource from '../resources/tms';
import XyzResource from '../resources/xyz';
import type { MapLibreStyle } from '../themes/maplibre';

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
    if (!this.sources.has(layer.source)) throw new Error(`No source ${layer.source} for layer ${layer.id}`);
    this.layers.set(layer.id, layer);
  }
  removeLayer(id: string) {
    this.layers.delete(id);
  }
}

const style = { opacity: 0.8 } as MapLibreStyle;

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
    expect(maxzoom()).toEqual(7);
  });

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
