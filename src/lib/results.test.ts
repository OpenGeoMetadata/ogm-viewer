/** @vitest-environment happy-dom */
// A DOM, because a marker is now a picture drawn on a canvas rather than a description handed to
// MapLibre. happy-dom has no canvas behind its <canvas>, which is the case markerImage answers for -
// what it draws when there is one is checked in a browser, since that is the only place pixels exist.
import { describe, it, expect, vi } from '@stencil/vitest';
import { LngLatBounds, type LngLatBoundsLike } from 'maplibre-gl';

import { drawResults, SELECTED_BOUNDS, markerImage, markerImageId, numberedResults, RESULT_MARKERS, RESULT_NUMBERS, resultMarkersLayer, SEARCH_BOUNDS } from './results';
import type { MapLibreStyle } from './themes/maplibre';

// Just enough of a MapLibre map to record what goes on it, in the order it went on, and to be changed
// in place afterwards: a source hands back something with setData on it, an image that is already there
// is refused a second time the way the real one does, and paint properties are written where the layer
// stands. Between them those are every way a redraw can avoid taking something off the map.
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
  hasImage(id: string) {
    return this.images.has(id);
  }
  listImages() {
    return [...this.images.keys()];
  }

  getSource(id: string) {
    return this.sources.get(id);
  }
  addSource(id: string, spec: any) {
    this.sources.set(id, { ...spec, setData: (data: any) => (this.sources.get(id).data = data) });
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
  setPaintProperty(id: string, property: string, value: unknown) {
    this.layers.get(id).paint[property] = value;
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
    const { features } = numberedResults([CALIFORNIA, ICELAND], style);

    expect(features.map(feature => feature.properties!.label)).toEqual(['1', '2']);
  });

  it('should put each number in the middle of its own box', () => {
    const [california] = numberedResults([CALIFORNIA], style).features;

    expect(california.geometry.coordinates[0]).toBeCloseTo(-119.27);
    expect(california.geometry.coordinates[1]).toBeCloseTo(37.27);
  });

  // The middle of 170..190 is the date line, not Greenwich. MapLibre reads a longitude from outside
  // -180..180 everywhere it takes one, so there is nothing here that has to wrap it back.
  it('should keep a number on the same side of the world as the box it belongs to', () => {
    const [aleutians] = numberedResults([ALEUTIANS], style).features;

    expect(aleutians.geometry.coordinates[0]).toEqual(180);
  });

  // The number is where the record sits in the list beside the map, so a record nobody could place
  // has to spend its number rather than pass it on to the next one.
  it('should spend a number on a record it has nowhere to put', () => {
    const { features } = numberedResults([CALIFORNIA, undefined, ICELAND], style);

    expect(features).toHaveLength(2);
    expect(features.map(feature => feature.properties!.label)).toEqual(['1', '3']);
  });

  it('should have nothing to draw when no record says where it is', () => {
    expect(numberedResults([undefined], style).features).toEqual([]);
  });

  it('should mark the result at the place it was pointed at', () => {
    const { features } = numberedResults([CALIFORNIA, ICELAND], style, 2);

    expect(features.map(feature => feature.properties!.selected)).toEqual([false, true]);
  });

  // The picture each marker is drawn as. Named on the feature rather than worked out in an expression,
  // so one place decides which marker wears which.
  it('should name the picture each marker is drawn as', () => {
    const { features } = numberedResults([CALIFORNIA, ICELAND], style, 2);

    expect(features.map(feature => feature.properties!.icon)).toEqual([markerImageId('1', style), markerImageId('2', style, true)]);
    expect(markerImageId('2', style, true)).not.toEqual(markerImageId('2', style));
  });

  it('should mark nothing when nothing was pointed at', () => {
    const { features } = numberedResults([CALIFORNIA, ICELAND], style);

    expect(features.map(feature => feature.properties!.selected)).toEqual([false, false]);
  });

  // The places are counted over every result, so a highlight can land on one that was never drawn
  it('should mark nothing for a place it has nowhere to put', () => {
    const { features } = numberedResults([CALIFORNIA, undefined], style, 2);

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
    expect([...map.layers.keys()]).toEqual([...BOX_LAYERS(SEARCH_BOUNDS), ...BOX_LAYERS(SELECTED_BOUNDS), ...MARKER_LAYERS]);
  });

  // A page of boxes says less than a page of numbers a reader can find in the list beside the map. The
  // two boxes are on the map either way, holding nothing until there is something for them to say:
  // that is what lets them stay under the numbers without being put back there on every draw.
  it('should draw nothing of a result but its number', () => {
    const map = draw([CALIFORNIA]);

    expect(marked(map)).toHaveLength(1);
    expect(map.sources.get(SEARCH_BOUNDS).data.features).toEqual([]);
    expect(map.sources.get(SELECTED_BOUNDS).data.features).toEqual([]);
  });

  // The whole of why a highlight doesn't flash. Both are asserted through the fake, which refuses a
  // second image under a name it already holds the way MapLibre does, and which is holding the pictures
  // a canvas would have drawn - there is none in this DOM; see markerImage.
  it('should change no pictures at all when the highlight moves', () => {
    const map = draw([CALIFORNIA, ICELAND]);
    for (const label of ['1', '2']) for (const id of [markerImageId(label, style), markerImageId(label, style, true)]) map.addImage(id, {}, {});
    const addImage = vi.spyOn(map, 'addImage');
    const removeImage = vi.spyOn(map, 'removeImage');

    drawResults(map as unknown as maplibregl.Map, style, { extents: [CALIFORNIA, ICELAND], highlighted: 2 });

    expect(addImage).not.toHaveBeenCalled();
    expect(removeImage).not.toHaveBeenCalled();
  });

  // Both pictures of every number, so that which one a marker wears is a property rather than a swap
  it('should draw each number both ways, pointed at or not', () => {
    const map = draw([CALIFORNIA]);
    map.addImage(markerImageId('1', style), {}, {});
    const addImage = vi.spyOn(map, 'addImage');

    // A canvas would have drawn the other one here; this DOM has none, so what is asserted is the ask
    drawResults(map as unknown as maplibregl.Map, style, { extents: [CALIFORNIA] });

    expect(addImage).not.toHaveBeenCalledWith(markerImageId('1', style), expect.anything(), expect.anything());
    expect(markerImage(markerImageId('1', style), style.markerColor, style, 1)).toBeUndefined();
  });

  // MapLibre carries images across setStyle - it diffs the new style document against the old one, and
  // the diff has nothing to say about images - so a picture kept under a name that said only which
  // marker it was would leave the map wearing the palette it was drawn in. See markerImageId.
  it('should draw its pictures again for a palette that changed under it', () => {
    const map = draw([CALIFORNIA]);
    map.addImage(markerImageId('1', style), {}, {});
    const dusk = { ...style, markerColor: '#004ac3' };

    expect(markerImageId('1', dusk)).not.toEqual(markerImageId('1', style));

    drawResults(map as unknown as maplibregl.Map, dusk, { extents: [CALIFORNIA] });

    // The picture drawn in the old palette is gone; a canvas would have drawn the new one in its place
    expect(map.listImages()).toEqual([]);
  });

  // Left behind, they would outlive every marker that ever used them
  it('should take away the pictures no marker needs any more', () => {
    const map = draw([CALIFORNIA, ICELAND]);
    map.addImage(markerImageId('2', style), {}, {});
    map.addImage(markerImageId('2', style, true), {}, {});
    map.addImage('someone-elses-image', {}, {});

    drawResults(map as unknown as maplibregl.Map, style, { extents: [CALIFORNIA] });

    expect(map.listImages()).toEqual(['someone-elses-image']);
  });

  // addLayer appends, so a layer put back on would come back over whatever had been added above it -
  // and dropping a source drops its tiles, which is the frame a reader sees as a flash
  it('should take nothing off the map to draw again', () => {
    const map = draw([CALIFORNIA]);
    const removeLayer = vi.spyOn(map, 'removeLayer');
    const removeSource = vi.spyOn(map, 'removeSource');
    const order = [...map.layers.keys()];

    drawResults(map as unknown as maplibregl.Map, style, { extents: [CALIFORNIA, ICELAND], highlighted: 2, searchBounds: LngLatBounds.convert(ICELAND) });

    expect([...map.layers.keys()]).toEqual(order);
    expect(removeLayer).not.toHaveBeenCalled();
    expect(removeSource).not.toHaveBeenCalled();
  });

  it('should hand its sources new data rather than replacing them', () => {
    const map = draw([CALIFORNIA]);
    const numbers = map.sources.get(RESULT_NUMBERS);

    drawResults(map as unknown as maplibregl.Map, style, { extents: [CALIFORNIA, ICELAND] });

    expect(map.sources.get(RESULT_NUMBERS)).toBe(numbers);
    expect(numbers.data.features).toHaveLength(2);
  });

  // A theme swap empties the style document without asking, so a draw that follows one is a first draw
  // again: everything back, in the order that keeps the numbers over the boxes.
  it('should build itself again into a style document a theme swap emptied', () => {
    const map = draw([CALIFORNIA], { highlighted: 1 });
    map.sources.clear();
    map.layers.clear();
    map.images.clear();

    drawResults(map as unknown as maplibregl.Map, style, { extents: [CALIFORNIA], highlighted: 1 });

    expect([...map.layers.keys()]).toEqual([...BOX_LAYERS(SEARCH_BOUNDS), ...BOX_LAYERS(SELECTED_BOUNDS), ...MARKER_LAYERS]);
    expect(marked(map)).toHaveLength(1);
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

    expect(map.sources.get(SEARCH_BOUNDS).data.features).toEqual([]);
  });

  // Nothing takes these layers off again, so the colors have to be able to change where they stand:
  // a theme can swap under a map that is already drawn.
  it('should follow the colors of a theme that changed under it', () => {
    const map = draw([CALIFORNIA], { highlighted: 1 });

    drawResults(map as unknown as maplibregl.Map, { ...style, selectedColor: '#7a4600', strokeSelectedColor: '#4a0a0a' }, { extents: [CALIFORNIA], highlighted: 1 });

    expect(map.layers.get(`${SELECTED_BOUNDS}-fill`).paint['fill-color']).toEqual('#7a4600');
    expect(map.layers.get(`${SELECTED_BOUNDS}-outline`).paint['line-color']).toEqual('#4a0a0a');
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
      { label: '1', selected: false, icon: markerImageId('1', style) },
      { label: '2', selected: true, icon: markerImageId('2', style, true) },
    ]);
  });

  // There is no number on the map to bring forward and no extent to draw around, which is the truth
  it('should draw no extent for a selection it cannot place', () => {
    const map = draw([CALIFORNIA, undefined], { highlighted: 2 });

    expect(map.sources.get(SELECTED_BOUNDS).data.features).toEqual([]);
    expect(marked(map)).toEqual([{ label: '1', selected: false, icon: markerImageId('1', style) }]);
  });

  it('should take the extent away again when the highlight is withdrawn', () => {
    const map = draw([CALIFORNIA, ICELAND], { highlighted: 2 });

    drawResults(map as unknown as maplibregl.Map, style, { extents: [CALIFORNIA, ICELAND] });

    expect(map.sources.get(SELECTED_BOUNDS).data.features).toEqual([]);
  });
});
