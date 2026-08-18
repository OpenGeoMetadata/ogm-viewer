import { describe, it, expect } from '@stencil/vitest';
import type { LngLatBoundsLike } from 'maplibre-gl';

import { clearResultNumbers, drawResultNumbers, RESULT_NUMBERS, numberedResults, resultNumbersLayer } from './results';
import type { MapLibreStyle } from './themes/maplibre';

// Just enough of a MapLibre map to record what goes on it, in the order it went on
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
    this.layers.set(layer.id, layer);
  }
  removeLayer(id: string) {
    this.layers.delete(id);
  }
}

const style = {
  textColor: '#000',
  textHaloColor: '#fff',
  textFont: 'Noto Sans Regular',
  textSize: 12,
} as MapLibreStyle;

const CALIFORNIA: LngLatBoundsLike = [
  [-124.41, 32.53],
  [-114.13, 42.01],
];
const ICELAND: LngLatBoundsLike = [
  [-24.55, 63.39],
  [-13.49, 66.57],
];
// Written the way bboxToBounds hands one over: east carried past 180 rather than wrapped back
const ALEUTIANS: LngLatBoundsLike = [
  [170, 50],
  [190, 54],
];

const draw = (extents: (LngLatBoundsLike | undefined)[]) => {
  const map = new FakeMap();
  drawResultNumbers(map as unknown as maplibregl.Map, style, extents);
  return map;
};

describe('numberedResults', () => {
  it('should number the extents from one, in the order it was given them', () => {
    const { features } = numberedResults([CALIFORNIA, ICELAND]);

    expect(features.map(feature => feature.properties!.label)).toEqual(['1', '2']);
  });

  it('should put each number in the middle of its own box', () => {
    const [california] = numberedResults([CALIFORNIA]).features;

    expect(california.geometry.coordinates[0]).toBeCloseTo(-119.27);
    expect(california.geometry.coordinates[1]).toBeCloseTo(37.27);
  });

  // The middle of 170..190 is the date line, not Greenwich. MapLibre reads a longitude from outside
  // -180..180 everywhere it takes one, so there is nothing here that has to wrap it back.
  it('should keep a number on the same side of the world as the box it belongs to', () => {
    const [aleutians] = numberedResults([ALEUTIANS]).features;

    expect(aleutians.geometry.coordinates[0]).toEqual(180);
  });

  // The number is where the record sits in the list beside the map, so a record nobody could place
  // has to spend its number rather than pass it on to the next one.
  it('should spend a number on a record it has nowhere to put', () => {
    const { features } = numberedResults([CALIFORNIA, undefined, ICELAND]);

    expect(features).toHaveLength(2);
    expect(features.map(feature => feature.properties!.label)).toEqual(['1', '3']);
  });

  it('should have nothing to draw when no record says where it is', () => {
    expect(numberedResults([undefined]).features).toEqual([]);
  });
});

describe('resultNumbersLayer', () => {
  // A number that isn't there is worse than one that overlaps: the list beside the map is counting
  // on every one of them being findable, so neither the boxes already placed nor the other numbers
  // are allowed to cull one.
  it('should draw every number, whatever it lands on', () => {
    const { layout } = resultNumbersLayer(style);

    expect(layout!['text-allow-overlap']).toBe(true);
    expect(layout!['text-ignore-placement']).toBe(true);
  });

  it('should draw the numbers the way the theme draws text', () => {
    const layer = resultNumbersLayer(style);

    expect(layer.layout!['text-font']).toEqual([style.textFont]);
    expect(layer.paint!['text-color']).toEqual(style.textColor);
    expect(layer.paint!['text-halo-color']).toEqual(style.textHaloColor);
  });

  // Read against a whole globe rather than sitting beside a feature, so bigger than a feature label
  // and haloed harder - at this size a single pixel of outline disappears into the basemap.
  it('should ask for a number bigger than a label on a feature', () => {
    const layer = resultNumbersLayer(style);

    expect(layer.layout!['text-size']).toBeGreaterThan(style.textSize);
    expect(layer.paint!['text-halo-width']).toBeGreaterThan(1);
  });

  it('should take its numbers from the label each point carries', () => {
    expect(resultNumbersLayer(style).layout!['text-field']).toEqual(['get', 'label']);
  });
});

describe('drawResultNumbers', () => {
  it('should put a source and a layer on the map', () => {
    const map = draw([CALIFORNIA, ICELAND]);

    expect(map.sources.get(RESULT_NUMBERS).type).toEqual('geojson');
    expect(map.sources.get(RESULT_NUMBERS).data.features).toHaveLength(2);
    expect(map.layers.get(RESULT_NUMBERS).type).toEqual('symbol');
  });

  // addLayer appends, so the numbers only stay over the boxes if they go back on after the boxes
  // are redrawn. Adding them again rather than updating the source in place is what does that.
  it('should put the numbers back on top of boxes drawn after them', () => {
    const map = draw([CALIFORNIA]);
    map.addLayer({ id: 'a-box', type: 'fill' });
    drawResultNumbers(map as unknown as maplibregl.Map, style, [CALIFORNIA, ICELAND]);

    expect([...map.layers.keys()]).toEqual(['a-box', RESULT_NUMBERS]);
  });

  it('should take the numbers off the map when cleared', () => {
    const map = draw([CALIFORNIA]);
    clearResultNumbers(map as unknown as maplibregl.Map);

    expect(map.sources.size).toEqual(0);
    expect(map.layers.size).toEqual(0);
  });

  // A theme swap empties the style document without asking, so the layer this last drew may be
  // gone by the time anyone thinks to take it off
  it('should have nothing to say about numbers a style swap already took away', () => {
    expect(() => clearResultNumbers(new FakeMap() as unknown as maplibregl.Map)).not.toThrow();
  });
});
