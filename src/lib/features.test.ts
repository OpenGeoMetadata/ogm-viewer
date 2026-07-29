import { describe, it, expect } from '@stencil/vitest';
import type { MapGeoJSONFeature } from 'maplibre-gl';

import { dedupeFeatures } from './features';

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
