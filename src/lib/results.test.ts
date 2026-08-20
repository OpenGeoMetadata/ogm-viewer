import { describe, it, expect } from '@stencil/vitest';
import { LngLatBounds, type LngLatBoundsLike } from 'maplibre-gl';

import { clearResults, drawResults, HIGHLIGHT_BOUNDS, numberedResults, RESULT_HIGHLIGHT, RESULT_NUMBERS, resultNumbersLayers, SEARCH_BOUNDS } from './results';
import { contrastColor } from './themes/color';
import type { MapLibreStyle } from './themes/maplibre';

// Just enough of a MapLibre map to record what goes on it, in the order it went on. removeSource
// refuses while a layer is still reading it, the way the real one does: that ordering is the one
// mistake clearResults can make.
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
    const reader = [...this.layers.values()].find(layer => layer.source === id);
    if (reader) throw new Error(`Source "${id}" cannot be removed while layer "${reader.id}" is using it.`);
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
  dataColor: '#9fceff',
  strokeColor: '#517daa',
  highlightColor: '#7fd6ec',
  strokeHighlightColor: '#268499',
  markerColor: '#2d5883',
  markerHighlightColor: '#006175',
  textColor: '#000',
  textHaloColor: '#fff',
  textFont: 'Noto Sans Regular',
  textSize: 12,
  boundsOpacity: 0.6,
  highlightOpacity: 0.8,
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

const NUMBER_LAYERS = [`${RESULT_NUMBERS}-circle`, `${RESULT_NUMBERS}-label`, `${RESULT_HIGHLIGHT}-circle`, `${RESULT_HIGHLIGHT}-label`];
const BOX_LAYERS = (id: string) => [`${id}-fill`, `${id}-outline`];

const draw = (extents: (LngLatBoundsLike | undefined)[], rest: { highlighted?: number; searchBounds?: LngLatBounds } = {}) => {
  const map = new FakeMap();
  drawResults(map as unknown as maplibregl.Map, style, { extents, ...rest });
  return map;
};

const marked = (map: FakeMap) => map.sources.get(RESULT_NUMBERS).data.features.map((feature: GeoJSON.Feature) => feature.properties);

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

  it('should mark the result at the highlighted place', () => {
    const { features } = numberedResults([CALIFORNIA, ICELAND], 2);

    expect(features.map(feature => feature.properties!.highlighted)).toEqual([false, true]);
  });

  it('should mark nothing when nothing is highlighted', () => {
    const { features } = numberedResults([CALIFORNIA, ICELAND]);

    expect(features.map(feature => feature.properties!.highlighted)).toEqual([false, false]);
  });

  // The places are counted over every result, so a highlight can land on one that was never drawn
  it('should mark nothing for a place it has nowhere to put', () => {
    const { features } = numberedResults([CALIFORNIA, undefined], 2);

    expect(features.map(feature => feature.properties!.highlighted)).toEqual([false]);
  });
});

describe('resultNumbersLayers', () => {
  // A number that isn't there is worse than one that overlaps: the list beside the map is counting
  // on every one of them being findable, so nothing may cull one. What the numbers do get is room
  // around them, which pushes the basemap's own labels out from under them instead.
  it('should draw every number, and clear a little space around each', () => {
    const [, label] = resultNumbersLayers(style);

    expect(label.layout!['text-allow-overlap']).toBe(true);
    expect(label.layout!['text-padding']).toBeGreaterThan(2);
    // Deliberately absent: MapLibre's own default of false is what puts these in the collision grid,
    // so a basemap label that wants the same space is the one that gets dropped
    expect(label.layout!['text-ignore-placement']).toBeUndefined();
  });

  it('should draw the numbers the way the theme draws text', () => {
    const [, label] = resultNumbersLayers(style);

    expect(label.layout!['text-font']).toEqual([style.textFont]);
    expect(label.paint!['text-color']).toEqual(contrastColor(style.markerColor));
    // The disc's own color, so a numeral doesn't touch the ring around it
    expect(label.paint!['text-halo-color']).toEqual(style.markerColor);
  });

  // Read against a whole globe rather than sitting beside a feature, so bigger than a feature label
  it('should ask for a number bigger than a label on a feature', () => {
    const [, label] = resultNumbersLayers(style);

    expect(label.layout!['text-size']).toBeGreaterThan(style.textSize);
  });

  it('should take its numbers from the label each point carries', () => {
    expect(resultNumbersLayers(style)[1].layout!['text-field']).toEqual(['get', 'label']);
  });

  it('should draw a disc behind each number', () => {
    const [disc, label] = resultNumbersLayers(style);

    expect(disc.type).toEqual('circle');
    expect(disc.source).toEqual(label.source);
    expect(disc.paint!['circle-color']).toEqual(style.markerColor);
    expect(disc.paint!['circle-stroke-width']).toBeGreaterThan(0);
  });

  // Stepped rather than grown smoothly, so eight results don't wear eight slightly different discs
  it('should widen the disc for a longer number', () => {
    const [disc] = resultNumbersLayers(style);
    const [, , one, , two, , three] = disc.paint!['circle-radius'] as [string, unknown, number, number, number, number, number];

    expect(one).toBeLessThan(two);
    expect(two).toBeLessThan(three);
  });

  // Which is the only arrangement that lifts a whole marker: a symbol layer draws all of its text
  // after all of its icons, so one pair can never put one feature's disc and number above another's.
  it('should draw the highlighted number in its own color, from a layer of its own', () => {
    const [disc, label] = resultNumbersLayers(style, true);

    expect([disc.id, label.id]).toEqual([`${RESULT_HIGHLIGHT}-circle`, `${RESULT_HIGHLIGHT}-label`]);
    expect(disc.paint!['circle-color']).toEqual(style.markerHighlightColor);
    expect(label.paint!['text-halo-color']).toEqual(style.markerHighlightColor);
    // Both pairs read the one source, from opposite sides of the same mark
    expect(disc.source).toEqual(RESULT_NUMBERS);
    expect(disc.filter).toEqual(['==', ['get', 'highlighted'], true]);
    expect(resultNumbersLayers(style)[0].filter).toEqual(['!=', ['get', 'highlighted'], true]);
  });

  // Without a key of its own MapLibre orders symbols by where they land on screen, so they restack as
  // the reader pans - which reads as the numbers rearranging themselves. Both properties draw a higher
  // key over a lower one, so the key is the number negated: result 1 sorts above result 20.
  it('should keep the earlier results on top of the later ones', () => {
    const [disc, label] = resultNumbersLayers(style);

    expect(disc.layout!['circle-sort-key']).toEqual(['-', 0, ['to-number', ['get', 'label']]]);
    expect(label.layout!['symbol-sort-key']).toEqual(disc.layout!['circle-sort-key']);
  });
});

describe('drawResults', () => {
  it('should put the numbers and their discs on the map', () => {
    const map = draw([CALIFORNIA, ICELAND]);

    expect(map.sources.get(RESULT_NUMBERS).type).toEqual('geojson');
    expect(map.sources.get(RESULT_NUMBERS).data.features).toHaveLength(2);
    expect([...map.layers.keys()]).toEqual(NUMBER_LAYERS);
  });

  // A page of boxes says less than a page of numbers a reader can find in the list beside the map
  it('should draw nothing of a result but its number', () => {
    const map = draw([CALIFORNIA]);

    expect([...map.sources.keys()]).toEqual([RESULT_NUMBERS]);
  });

  // addLayer appends, so the numbers only stay over the boxes if they go back on after the boxes
  // are redrawn. Adding them again rather than updating the source in place is what does that.
  it('should put the numbers back on top of boxes drawn after them', () => {
    const map = draw([CALIFORNIA]);
    map.addLayer({ id: 'a-box', type: 'fill' });
    drawResults(map as unknown as maplibregl.Map, style, { extents: [CALIFORNIA, ICELAND] });

    expect([...map.layers.keys()]).toEqual(['a-box', ...NUMBER_LAYERS]);
  });

  it('should draw the searched area, then the highlight, then the numbers', () => {
    const map = draw([CALIFORNIA, ICELAND], { highlighted: 2, searchBounds: LngLatBounds.convert(CALIFORNIA) });

    expect([...map.layers.keys()]).toEqual([...BOX_LAYERS(SEARCH_BOUNDS), ...BOX_LAYERS(HIGHLIGHT_BOUNDS), ...NUMBER_LAYERS]);
  });

  it('should draw the area being searched in the colors a bounding box gets', () => {
    const map = draw([], { searchBounds: LngLatBounds.convert(CALIFORNIA) });

    expect(map.layers.get(`${SEARCH_BOUNDS}-outline`).paint['line-color']).toEqual(style.strokeColor);
    expect(map.layers.get(`${SEARCH_BOUNDS}-outline`).paint['line-opacity']).toEqual(style.boundsOpacity);
    expect(map.layers.get(`${SEARCH_BOUNDS}-fill`).paint['fill-color']).toEqual(style.dataColor);
    // The wash is held below the outline, the way a location's is
    expect(map.layers.get(`${SEARCH_BOUNDS}-fill`).paint['fill-opacity']).toBeLessThan(style.boundsOpacity);
  });

  it('should draw nothing for a search area it was not given', () => {
    const map = draw([CALIFORNIA]);

    expect(map.sources.has(SEARCH_BOUNDS)).toBe(false);
  });

  it('should draw the highlighted result’s own extent, in the highlight colors', () => {
    const map = draw([CALIFORNIA, ICELAND], { highlighted: 2 });

    expect(map.sources.get(HIGHLIGHT_BOUNDS).data.geometry.coordinates[0][0]).toEqual([-24.55, 63.39]);
    expect(map.layers.get(`${HIGHLIGHT_BOUNDS}-outline`).paint['line-color']).toEqual(style.strokeHighlightColor);
    expect(map.layers.get(`${HIGHLIGHT_BOUNDS}-outline`).paint['line-opacity']).toEqual(style.highlightOpacity);
    expect(marked(map)).toEqual([
      { label: '1', highlighted: false },
      { label: '2', highlighted: true },
    ]);
  });

  // There is no number on the map to bring forward and no extent to draw around, which is the truth
  it('should draw no extent for a highlight it cannot place', () => {
    const map = draw([CALIFORNIA, undefined], { highlighted: 2 });

    expect(map.sources.has(HIGHLIGHT_BOUNDS)).toBe(false);
    expect(marked(map)).toEqual([{ label: '1', highlighted: false }]);
  });

  it('should take everything off the map when cleared', () => {
    const map = draw([CALIFORNIA], { highlighted: 1, searchBounds: LngLatBounds.convert(ICELAND) });
    clearResults(map as unknown as maplibregl.Map);

    expect(map.sources.size).toEqual(0);
    expect(map.layers.size).toEqual(0);
  });

  // Which is what the fake above refuses, the way MapLibre does
  it('should take every layer off before the source it reads', () => {
    const map = draw([CALIFORNIA], { highlighted: 1, searchBounds: LngLatBounds.convert(ICELAND) });

    expect(() => clearResults(map as unknown as maplibregl.Map)).not.toThrow();
  });

  // A theme swap empties the style document without asking, so what this last drew may be gone by
  // the time anyone thinks to take it off
  it('should have nothing to say about layers a style swap already took away', () => {
    expect(() => clearResults(new FakeMap() as unknown as maplibregl.Map)).not.toThrow();
  });
});
