import { describe, it, expect } from '@stencil/vitest';
import type { MapGeoJSONFeature } from 'maplibre-gl';

import { dedupeFeatures, getFeatureTitle } from './features';

const SOURCE = 'ark-77981-gmgscj87k49-openindexmap';

// An entry as an inspection answers with it: what names the feature, plus enough properties to tell
// one entry's record from another's in the assertions
const entry = (overrides: Partial<MapGeoJSONFeature>): MapGeoJSONFeature =>
  ({
    source: SOURCE,
    sourceLayer: undefined,
    id: 1,
    layer: { id: `${SOURCE}-polygons`, type: 'fill', source: SOURCE },
    properties: { label: 'SF 20' },
    ...overrides,
  }) as unknown as MapGeoJSONFeature;

describe('dedupeFeatures', () => {
  it('has nothing to do to an empty answer', () => {
    expect(dedupeFeatures([])).toEqual([]);
  });

  it('leaves an answer that names each feature once alone', () => {
    const features = [entry({ id: 1 }), entry({ id: 2 }), entry({ id: 3 })];

    expect(dedupeFeatures(features)).toEqual(features);
  });

  it('collapses a feature the map drew in more than one piece', () => {
    const tileA = entry({ id: 7, properties: { label: 'SF 19' } });
    const tileB = entry({ id: 7, properties: { label: 'SF 19' } });

    expect(dedupeFeatures([tileA, tileB])).toEqual([tileA]);
  });

  it('collapses a feature reported once per style layer that draws it', () => {
    const fill = entry({ layer: { id: 'preview-polygons', type: 'fill', source: SOURCE } });
    const outline = entry({ layer: { id: 'preview-lines', type: 'line', source: SOURCE } });

    expect(dedupeFeatures([fill, outline])).toEqual([fill]);
  });

  it('keeps the first entry for a feature, in the order the answer came in', () => {
    const first = entry({ id: 1, properties: { label: 'first' } });
    const other = entry({ id: 2, properties: { label: 'other' } });
    const repeat = entry({ id: 1, properties: { label: 'repeat' } });

    expect(dedupeFeatures([first, other, repeat])).toEqual([first, other]);
  });

  it('treats ids that stringify alike as one feature, as setFeatureState does', () => {
    const numeric = entry({ id: 5 });
    const text = entry({ id: '5' });

    expect(dedupeFeatures([numeric, text])).toEqual([numeric]);
  });

  it('keeps features that share an id across different sources', () => {
    const overlay = entry({ id: 1, source: 'record-geojson' });
    const index = entry({ id: 1, source: 'record-openindexmap' });

    expect(dedupeFeatures([overlay, index])).toEqual([overlay, index]);
  });

  it('keeps features that share an id across different source layers', () => {
    const water = entry({ id: 1, sourceLayer: 'water' });
    const landuse = entry({ id: 1, sourceLayer: 'landuse' });

    expect(dedupeFeatures([water, landuse])).toEqual([water, landuse]);
  });

  it('keeps every feature that came back without an id to be identified by', () => {
    const one = entry({ id: undefined, properties: { TRACT: '000300' } });
    const two = entry({ id: undefined, properties: { TRACT: '000400' } });
    const three = entry({ id: null as unknown as undefined, properties: { TRACT: '000500' } });

    expect(dedupeFeatures([one, two, three])).toEqual([one, two, three]);
  });
});

// Bright Angel as gov.usgs indexes it: fourteen editions of one sheet sharing an outline, listed oldest
// first so the latest is drawn on top, with one label between them. MapLibre answers top down, layer by
// layer - the label first, since it is drawn over everything, then the outlines and the fills, each
// from the top of the stack down.
describe('dedupeFeatures, for a stack under one label', () => {
  const EDITIONS = [19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6];

  const label = (id: number) => entry({ id, layer: { id: `${SOURCE}-polygon-labels`, type: 'symbol', source: SOURCE } });
  const outline = (id: number) => entry({ id, layer: { id: `${SOURCE}-polygon-outlines`, type: 'line', source: SOURCE } });
  const fill = (id: number) => entry({ id });

  const besideLabel = () => [...EDITIONS.map(outline), ...EDITIONS.map(fill)];
  const ids = (features: MapGeoJSONFeature[]) => features.map(feature => feature.id);

  // Placement decides which edition gets the label, and it was the oldest: the first in the document
  it('lists the stack from the top, whichever edition the label names', () => {
    expect(ids(dedupeFeatures([label(6), ...besideLabel()]))).toEqual(EDITIONS);
    expect(ids(dedupeFeatures([label(12), ...besideLabel()]))).toEqual(EDITIONS);
  });

  it('lists the stack the same way whether the click lands on its label or beside it', () => {
    expect(dedupeFeatures([label(6), ...besideLabel()])).toEqual(dedupeFeatures(besideLabel()));
  });

  // A point's label sits above the point, and a long sheet label runs out over its neighbours
  it('keeps a feature the click reached only through its label where the label put it', () => {
    const neighbour = label(23);

    expect(ids(dedupeFeatures([neighbour, ...besideLabel()]))).toEqual([23, ...EDITIONS]);
  });

  it('keeps one entry for a feature reached only through its label, however many came back', () => {
    expect(ids(dedupeFeatures([label(23), label(23)]))).toEqual([23]);
  });
});

describe('getFeatureTitle', () => {
  it('calls a feature what the data calls it', () => {
    expect(getFeatureTitle(entry({ properties: { label: 'SF 20' } }))).toEqual('SF 20');
  });

  it('calls a feature the data does not name a feature', () => {
    expect(getFeatureTitle(entry({ id: 12, properties: { TRACT: '000300' } }))).toEqual('Feature');
  });

  // The bug this row exists to avoid: an /identify response has no features until we ask for them, so
  // we number the answer to have something to draw the selection from, and the first of them read as
  // "Feature 0" every time - a number the reader has no way to recognize.
  it('says nothing of an id nobody put there', () => {
    expect(getFeatureTitle(entry({ id: 0, properties: { Pixel: '12' } }))).toEqual('Feature');
  });

  it('has something to call a feature that arrived with no properties at all', () => {
    expect(getFeatureTitle(entry({ id: undefined, properties: undefined }))).toEqual('Feature');
  });
});
