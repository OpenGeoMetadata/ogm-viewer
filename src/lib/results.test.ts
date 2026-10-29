/** @vitest-environment happy-dom */
import { describe, it, expect, vi } from '@stencil/vitest';
import { LngLatBounds, type LngLatBoundsLike, type MapLibreMap } from 'maplibre-gl';

import {
  drawResults,
  HIGHLIGHT_BOUNDS,
  markerImage,
  markerImageId,
  markerMetrics,
  numberedResults,
  RESULT_MARKERS,
  RESULT_NUMBERS,
  resultMarkersLayer,
  SEARCH_BOUNDS,
} from './results';
import type { MapLibreStyle } from './themes/maplibre';

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
  markerHighlightColor: '#268499',
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
const ALEUTIANS: LngLatBoundsLike = [
  [170, 50],
  [190, 54],
];

const MARKER_LAYERS = [RESULT_MARKERS];
const BOX_LAYERS = (id: string) => [`${id}-fill`, `${id}-outline`];

const draw = (extents: (LngLatBoundsLike | undefined)[], rest: { highlighted?: number[]; searchBounds?: LngLatBounds } = {}) => {
  const map = new FakeMap();
  drawResults(map as unknown as MapLibreMap, style, { extents, ...rest });
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

  it('should keep a number on the same side of the world as the box it belongs to', () => {
    const [aleutians] = numberedResults([ALEUTIANS], style).features;

    expect(aleutians.geometry.coordinates[0]).toEqual(180);
  });

  it('should spend a number on a record it has nowhere to put', () => {
    const { features } = numberedResults([CALIFORNIA, undefined, ICELAND], style);

    expect(features).toHaveLength(2);
    expect(features.map(feature => feature.properties!.label)).toEqual(['1', '3']);
  });

  it('should have nothing to draw when no record says where it is', () => {
    expect(numberedResults([undefined], style).features).toEqual([]);
  });

  it('should mark the result at the place it was pointed at', () => {
    const { features } = numberedResults([CALIFORNIA, ICELAND], style, [2]);

    expect(features.map(feature => feature.properties!.highlighted)).toEqual([false, true]);
  });

  it('should name the picture each marker is drawn as', () => {
    const { features } = numberedResults([CALIFORNIA, ICELAND], style, [2]);

    expect(features.map(feature => feature.properties!.icon)).toEqual([markerImageId('1', style), markerImageId('2', style, true)]);
    expect(markerImageId('2', style, true)).not.toEqual(markerImageId('2', style));
  });

  it('should mark nothing when nothing was pointed at', () => {
    const { features } = numberedResults([CALIFORNIA, ICELAND], style);

    expect(features.map(feature => feature.properties!.highlighted)).toEqual([false, false]);
  });

  it('should mark nothing for a place it has nowhere to put', () => {
    const { features } = numberedResults([CALIFORNIA, undefined], style, [2]);

    expect(features.map(feature => feature.properties!.highlighted)).toEqual([false]);
  });
});

describe('resultMarkersLayer', () => {
  it('should draw every marker from one layer, as an image apiece', () => {
    const layer = resultMarkersLayer();

    expect(layer.type).toEqual('symbol');
    expect(layer.source).toEqual(RESULT_NUMBERS);
    expect(layer.layout!['icon-image']).toEqual(['get', 'icon']);
    expect(layer.layout!['text-field']).toBeUndefined();
  });

  it('should draw every marker, whatever it lands on', () => {
    expect(resultMarkersLayer().layout!['icon-allow-overlap']).toBe(true);
    expect(resultMarkersLayer().layout!['icon-ignore-placement']).toBeUndefined();
  });

  it('should keep the earlier results on top of the later ones, and the highlight above both', () => {
    expect(resultMarkersLayer().layout!['symbol-sort-key']).toEqual(['case', ['get', 'highlighted'], 1, ['-', 0, ['to-number', ['get', 'label']]]]);
  });
});

describe('markerMetrics', () => {
  it('should draw a highlighted marker bigger than the rest', () => {
    expect(markerMetrics(style, true).box).toBeGreaterThan(markerMetrics(style, false).box);
    expect(markerMetrics(style, true).box / markerMetrics(style, false).box).toBeLessThan(1.3);
  });

  it('should grow the numeral with the disc', () => {
    const plain = markerMetrics(style, false);
    const grown = markerMetrics(style, true);

    expect(grown.size / plain.size).toBeCloseTo(grown.radius / plain.radius);
  });

  it('should leave the ring the same width on a marker that has come forward', () => {
    expect(markerMetrics(style, true).box - markerMetrics(style, true).radius * 2).toBeCloseTo(markerMetrics(style, false).box - markerMetrics(style, false).radius * 2, 0);
  });

  it('should follow the text size the theme was given', () => {
    expect(markerMetrics({ ...style, textSize: 24 }, false).box).toBeGreaterThan(markerMetrics({ ...style, textSize: 12 }, false).box);
  });
});

describe('markerImage', () => {
  it('should draw nothing where there is nothing to draw on', () => {
    expect(markerImage('1', style, false, 2)).toBeUndefined();
  });
});

describe('drawResults', () => {
  it('should put the numbers and their discs on the map', () => {
    const map = draw([CALIFORNIA, ICELAND]);

    expect(map.sources.get(RESULT_NUMBERS).type).toEqual('geojson');
    expect(map.sources.get(RESULT_NUMBERS).data.features).toHaveLength(2);
    expect([...map.layers.keys()]).toEqual([...BOX_LAYERS(SEARCH_BOUNDS), ...BOX_LAYERS(HIGHLIGHT_BOUNDS), ...MARKER_LAYERS]);
  });

  it('should draw nothing of a result but its number', () => {
    const map = draw([CALIFORNIA]);

    expect(marked(map)).toHaveLength(1);
    expect(map.sources.get(SEARCH_BOUNDS).data.features).toEqual([]);
    expect(map.sources.get(HIGHLIGHT_BOUNDS).data.features).toEqual([]);
  });

  it('should change no pictures at all when the highlight moves', () => {
    const map = draw([CALIFORNIA, ICELAND]);
    for (const label of ['1', '2']) for (const id of [markerImageId(label, style), markerImageId(label, style, true)]) map.addImage(id, {}, {});
    const addImage = vi.spyOn(map, 'addImage');
    const removeImage = vi.spyOn(map, 'removeImage');

    drawResults(map as unknown as MapLibreMap, style, { extents: [CALIFORNIA, ICELAND], highlighted: [2] });

    expect(addImage).not.toHaveBeenCalled();
    expect(removeImage).not.toHaveBeenCalled();
  });

  it('should draw each number both ways, pointed at or not', () => {
    const map = draw([CALIFORNIA]);
    map.addImage(markerImageId('1', style), {}, {});
    const addImage = vi.spyOn(map, 'addImage');

    drawResults(map as unknown as MapLibreMap, style, { extents: [CALIFORNIA] });

    expect(addImage).not.toHaveBeenCalledWith(markerImageId('1', style), expect.anything(), expect.anything());
    expect(addImage).toHaveBeenCalledTimes(0);
  });

  it('should draw its pictures again for a palette that changed under it', () => {
    const map = draw([CALIFORNIA]);
    map.addImage(markerImageId('1', style), {}, {});
    const dusk = { ...style, markerColor: '#004ac3' };

    expect(markerImageId('1', dusk)).not.toEqual(markerImageId('1', style));

    drawResults(map as unknown as MapLibreMap, dusk, { extents: [CALIFORNIA] });

    expect(map.listImages()).toEqual([]);
  });

  it('should take away the pictures no marker needs any more', () => {
    const map = draw([CALIFORNIA, ICELAND]);
    map.addImage(markerImageId('2', style), {}, {});
    map.addImage(markerImageId('2', style, true), {}, {});
    map.addImage('someone-elses-image', {}, {});

    drawResults(map as unknown as MapLibreMap, style, { extents: [CALIFORNIA] });

    expect(map.listImages()).toEqual(['someone-elses-image']);
  });

  it('should take nothing off the map to draw again', () => {
    const map = draw([CALIFORNIA]);
    const removeLayer = vi.spyOn(map, 'removeLayer');
    const removeSource = vi.spyOn(map, 'removeSource');
    const order = [...map.layers.keys()];

    drawResults(map as unknown as MapLibreMap, style, { extents: [CALIFORNIA, ICELAND], highlighted: [2], searchBounds: LngLatBounds.convert(ICELAND) });

    expect([...map.layers.keys()]).toEqual(order);
    expect(removeLayer).not.toHaveBeenCalled();
    expect(removeSource).not.toHaveBeenCalled();
  });

  it('should hand its sources new data rather than replacing them', () => {
    const map = draw([CALIFORNIA]);
    const numbers = map.sources.get(RESULT_NUMBERS);

    drawResults(map as unknown as MapLibreMap, style, { extents: [CALIFORNIA, ICELAND] });

    expect(map.sources.get(RESULT_NUMBERS)).toBe(numbers);
    expect(numbers.data.features).toHaveLength(2);
  });

  it('should build itself again into a style document a theme swap emptied', () => {
    const map = draw([CALIFORNIA], { highlighted: [1] });
    map.sources.clear();
    map.layers.clear();
    map.images.clear();

    drawResults(map as unknown as MapLibreMap, style, { extents: [CALIFORNIA], highlighted: [1] });

    expect([...map.layers.keys()]).toEqual([...BOX_LAYERS(SEARCH_BOUNDS), ...BOX_LAYERS(HIGHLIGHT_BOUNDS), ...MARKER_LAYERS]);
    expect(marked(map)).toHaveLength(1);
  });

  it('should draw the searched area, then the highlight, then the numbers', () => {
    const map = draw([CALIFORNIA, ICELAND], { highlighted: [2], searchBounds: LngLatBounds.convert(CALIFORNIA) });

    expect([...map.layers.keys()]).toEqual([...BOX_LAYERS(SEARCH_BOUNDS), ...BOX_LAYERS(HIGHLIGHT_BOUNDS), ...MARKER_LAYERS]);
  });

  it('should draw the area being searched in the colors a bounding box gets', () => {
    const map = draw([], { searchBounds: LngLatBounds.convert(CALIFORNIA) });

    expect(map.layers.get(`${SEARCH_BOUNDS}-outline`).paint['line-color']).toEqual(style.strokeColor);
    expect(map.layers.get(`${SEARCH_BOUNDS}-outline`).paint['line-opacity']).toEqual(style.boundsOpacity);
    expect(map.layers.get(`${SEARCH_BOUNDS}-fill`).paint['fill-color']).toEqual(style.dataColor);
    expect(map.layers.get(`${SEARCH_BOUNDS}-fill`).paint['fill-opacity']).toBeLessThan(style.boundsOpacity);
  });

  it('should draw nothing for a search area it was not given', () => {
    const map = draw([CALIFORNIA]);

    expect(map.sources.get(SEARCH_BOUNDS).data.features).toEqual([]);
  });

  it('should follow the colors of a theme that changed under it', () => {
    const map = draw([CALIFORNIA], { highlighted: [1] });

    drawResults(map as unknown as MapLibreMap, { ...style, highlightColor: '#7a4600', strokeHighlightColor: '#4a0a0a' }, { extents: [CALIFORNIA], highlighted: [1] });

    expect(map.layers.get(`${HIGHLIGHT_BOUNDS}-fill`).paint['fill-color']).toEqual('#7a4600');
    expect(map.layers.get(`${HIGHLIGHT_BOUNDS}-outline`).paint['line-color']).toEqual('#4a0a0a');
  });

  it('should draw a highlighted result’s own extent, in the colors of a hover', () => {
    const map = draw([CALIFORNIA, ICELAND], { highlighted: [2] });

    expect(map.sources.get(HIGHLIGHT_BOUNDS).data.features[0].geometry.coordinates[0][0]).toEqual([-24.55, 63.39]);
    expect(map.layers.get(`${HIGHLIGHT_BOUNDS}-outline`).paint['line-color']).toEqual(style.strokeHighlightColor);
    expect(map.layers.get(`${HIGHLIGHT_BOUNDS}-fill`).paint['fill-color']).toEqual(style.highlightColor);
    expect(map.layers.get(`${HIGHLIGHT_BOUNDS}-outline`).paint['line-opacity']).toEqual(style.highlightOpacity);
    expect(marked(map)).toEqual([
      { label: '1', highlighted: false, icon: markerImageId('1', style) },
      { label: '2', highlighted: true, icon: markerImageId('2', style, true) },
    ]);
  });

  it('should draw no extent for a highlight it cannot place', () => {
    const map = draw([CALIFORNIA, undefined], { highlighted: [2] });

    expect(map.sources.get(HIGHLIGHT_BOUNDS).data.features).toEqual([]);
    expect(marked(map)).toEqual([{ label: '1', highlighted: false, icon: markerImageId('1', style) }]);
  });

  it('should draw every result being highlighted, and a box for each', () => {
    const map = draw([CALIFORNIA, ICELAND], { highlighted: [1, 2] });

    expect(marked(map).map((properties: { highlighted: boolean }) => properties.highlighted)).toEqual([true, true]);
    expect(map.sources.get(HIGHLIGHT_BOUNDS).data.features).toHaveLength(2);
    expect(map.sources.get(HIGHLIGHT_BOUNDS).data.features.map((feature: GeoJSON.Feature) => feature.geometry.type)).toEqual(['Polygon', 'Polygon']);
  });

  it('should take the extent away again when the highlight is withdrawn', () => {
    const map = draw([CALIFORNIA, ICELAND], { highlighted: [2] });

    drawResults(map as unknown as MapLibreMap, style, { extents: [CALIFORNIA, ICELAND] });

    expect(map.sources.get(HIGHLIGHT_BOUNDS).data.features).toEqual([]);
  });
});
