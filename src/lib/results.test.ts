/** @vitest-environment happy-dom */
// A DOM, because a marker is now a picture drawn on a canvas rather than a description handed to
// MapLibre. happy-dom has no canvas behind its <canvas>, which is the case markerImage answers for -
// what it draws when there is one is checked in a browser, since that is the only place pixels exist.
import { describe, it, expect } from '@stencil/vitest';
import { LngLatBounds, type LngLatBoundsLike } from 'maplibre-gl';

import {
  clearResults,
  drawResults,
  SELECTED_BOUNDS,
  MARKER_IMAGE,
  markerImage,
  markerImageId,
  numberedResults,
  RESULT_MARKERS,
  RESULT_NUMBERS,
  resultMarkersLayer,
  SEARCH_BOUNDS,
} from './results';
import type { MapLibreStyle } from './themes/maplibre';

// Just enough of a MapLibre map to record what goes on it, in the order it went on. removeSource
// refuses while a layer is still reading it, the way the real one does: that ordering is the one
// mistake clearResults can make.
class FakeMap {
  sources = new Map<string, any>();
  layers = new Map<string, any>();
  images = new Map<string, any>();

  addImage(id: string, image: any, options: any) {
    if (this.images.has(id)) throw new Error(`An image named "${id}" already exists.`);
    this.images.set(id, { image, options });
  }
  removeImage(id: string) {
    if (!this.images.has(id)) throw new Error(`No image named "${id}" exists.`);
    this.images.delete(id);
  }
  listImages() {
    return [...this.images.keys()];
  }

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
  selectedColor: '#93da98',
  strokeSelectedColor: '#1e662a',
  markerColor: '#2d5883',
  markerSelectedColor: '#1e662a',
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

const MARKER_LAYERS = [RESULT_MARKERS];
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

  it('should mark the result at the place it was pointed at', () => {
    const { features } = numberedResults([CALIFORNIA, ICELAND], 2);

    expect(features.map(feature => feature.properties!.selected)).toEqual([false, true]);
  });

  // The picture each marker is drawn as. Named on the feature rather than worked out in an expression,
  // so one place decides which marker wears which.
  it('should name the picture each marker is drawn as', () => {
    const { features } = numberedResults([CALIFORNIA, ICELAND], 2);

    expect(features.map(feature => feature.properties!.icon)).toEqual([markerImageId('1'), markerImageId('2', true)]);
    expect(markerImageId('2', true)).not.toEqual(markerImageId('2'));
  });

  it('should mark nothing when nothing was pointed at', () => {
    const { features } = numberedResults([CALIFORNIA, ICELAND]);

    expect(features.map(feature => feature.properties!.selected)).toEqual([false, false]);
  });

  // The places are counted over every result, so a highlight can land on one that was never drawn
  it('should mark nothing for a place it has nowhere to put', () => {
    const { features } = numberedResults([CALIFORNIA, undefined], 2);

    expect(features.map(feature => feature.properties!.selected)).toEqual([false]);
  });
});

describe('resultMarkersLayer', () => {
  // The whole reason a marker is one picture: two layers cannot be made to interleave. A symbol layer
  // draws all of its text after all of its icons, and a circle layer draws every circle before any
  // layer above it, so numbers in a layer of their own land over every disc including their
  // neighbours'. One image apiece means whichever marker is on top covers the one under it whole.
  it('should draw every marker from one layer, as an image apiece', () => {
    const layer = resultMarkersLayer();

    expect(layer.type).toEqual('symbol');
    expect(layer.source).toEqual(RESULT_NUMBERS);
    expect(layer.layout!['icon-image']).toEqual(['get', 'icon']);
    // Nothing draws text: there is no second pass for a number to be left in
    expect(layer.layout!['text-field']).toBeUndefined();
  });

  // A number that isn't there is worse than one that overlaps: the list beside the map is counting on
  // every one of them being findable
  it('should draw every marker, whatever it lands on', () => {
    expect(resultMarkersLayer().layout!['icon-allow-overlap']).toBe(true);
    // Deliberately absent: MapLibre's own default of false is what puts these in the collision grid,
    // so a basemap label that wants the same space is the one that gets dropped
    expect(resultMarkersLayer().layout!['icon-ignore-placement']).toBeUndefined();
  });

  // Without a key of its own MapLibre orders symbols by where they land on screen, so they restack as
  // the reader pans - which reads as the numbers rearranging themselves. A higher key draws over a
  // lower one, so the key is the number negated, and the highlighted one sorts above all of them.
  it('should keep the earlier results on top of the later ones, and the highlight above both', () => {
    expect(resultMarkersLayer().layout!['symbol-sort-key']).toEqual(['case', ['get', 'selected'], 1, ['-', 0, ['to-number', ['get', 'label']]]]);
  });
});

describe('markerImage', () => {
  // There is no canvas in this DOM, which is the case the caller has to survive: a map missing its
  // numbers rather than a map that failed to open. What it draws when there is one is checked in a
  // browser, since that is the only place pixels exist.
  it('should draw nothing where there is nothing to draw on', () => {
    expect(markerImage('1', '#2d5883', style, 2)).toBeUndefined();
  });
});

describe('drawResults', () => {
  it('should put the numbers and their discs on the map', () => {
    const map = draw([CALIFORNIA, ICELAND]);

    expect(map.sources.get(RESULT_NUMBERS).type).toEqual('geojson');
    expect(map.sources.get(RESULT_NUMBERS).data.features).toHaveLength(2);
    expect([...map.layers.keys()]).toEqual(MARKER_LAYERS);
  });

  // Nothing is reused between draws: a theme swap changes what a marker looks like, and a picture kept
  // from the last palette would put a marker from the last theme on the map. Asserted through the fake,
  // which refuses a second image under a name it already holds the way MapLibre does.
  it('should draw its pictures again rather than reuse them', () => {
    const map = draw([CALIFORNIA, ICELAND]);
    map.addImage(`${MARKER_IMAGE}-1`, {}, {});

    expect(() => drawResults(map as unknown as maplibregl.Map, style, { extents: [CALIFORNIA, ICELAND] })).not.toThrow();
    expect(map.listImages().filter(id => id.startsWith(MARKER_IMAGE))).toEqual([]);
  });

  // Left behind, they would outlive every marker that ever used them
  it('should take its pictures off with everything else', () => {
    const map = draw([CALIFORNIA]);
    map.addImage(`${MARKER_IMAGE}-1`, {}, {});
    map.addImage('someone-elses-image', {}, {});

    clearResults(map as unknown as maplibregl.Map);

    expect(map.listImages()).toEqual(['someone-elses-image']);
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

    expect([...map.layers.keys()]).toEqual(['a-box', ...MARKER_LAYERS]);
  });

  it('should draw the searched area, then the highlight, then the numbers', () => {
    const map = draw([CALIFORNIA, ICELAND], { highlighted: 2, searchBounds: LngLatBounds.convert(CALIFORNIA) });

    expect([...map.layers.keys()]).toEqual([...BOX_LAYERS(SEARCH_BOUNDS), ...BOX_LAYERS(SELECTED_BOUNDS), ...MARKER_LAYERS]);
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

  // The colors a selected feature gets, not a hovered one: a hover is what points at it, but what it
  // means is that this is the result being read
  it('should draw the pointed-at result’s own extent, in the colors of a selection', () => {
    const map = draw([CALIFORNIA, ICELAND], { highlighted: 2 });

    expect(map.sources.get(SELECTED_BOUNDS).data.geometry.coordinates[0][0]).toEqual([-24.55, 63.39]);
    expect(map.layers.get(`${SELECTED_BOUNDS}-outline`).paint['line-color']).toEqual(style.strokeSelectedColor);
    expect(map.layers.get(`${SELECTED_BOUNDS}-fill`).paint['fill-color']).toEqual(style.selectedColor);
    expect(map.layers.get(`${SELECTED_BOUNDS}-outline`).paint['line-opacity']).toEqual(style.highlightOpacity);
    expect(marked(map)).toEqual([
      { label: '1', selected: false, icon: markerImageId('1') },
      { label: '2', selected: true, icon: markerImageId('2', true) },
    ]);
  });

  // There is no number on the map to bring forward and no extent to draw around, which is the truth
  it('should draw no extent for a selection it cannot place', () => {
    const map = draw([CALIFORNIA, undefined], { highlighted: 2 });

    expect(map.sources.has(SELECTED_BOUNDS)).toBe(false);
    expect(marked(map)).toEqual([{ label: '1', selected: false, icon: markerImageId('1') }]);
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
