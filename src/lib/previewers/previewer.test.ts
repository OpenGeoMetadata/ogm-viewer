import { describe, it, expect } from '@stencil/vitest';

import GeoJsonPreviewer from './geojson';
import OpenIndexMapPreviewer from './openindexmap';
import GeoJsonResource from '../resources/geojson';
import OpenIndexMapResource from '../resources/openindexmap';
import type { RequestTransform } from '../request';

describe('Previewer#kind', () => {
  // An index map is GeoJSON drawn the same way, and the difference between them is the only thing
  // that tells ogm-attributes it may describe the features by the OpenIndexMaps spec
  it("is the resource's own kind, so a component can tell one preview's features from another's", () => {
    expect(new GeoJsonPreviewer(new GeoJsonResource('id', 'https://example.com/data.json')).kind).toEqual('geojson');
    expect(new OpenIndexMapPreviewer(new OpenIndexMapResource('id', 'https://example.com/index.geojson')).kind).toEqual('openindexmap');
  });
});

describe('Previewer#resourceId', () => {
  // What <ogm-overview> matches a highlight named by id against, when it was handed previewers rather
  // than records. previewId can't answer it: it carries the kind and the renderer as well, so a page
  // holding a record's id has nothing to compare against.
  it('names the resource this preview draws, and nothing else about the preview', () => {
    const previewer = new GeoJsonPreviewer(new GeoJsonResource('a-record', 'https://example.com/data.json'));

    expect(previewer.resourceId).toEqual('a-record');
    expect(previewer.previewId).toEqual('a-record-geojson-map');
  });
});

describe('Previewer#requestTransform', () => {
  it("is undefined when the resource wasn't given one", () => {
    const previewer = new GeoJsonPreviewer(new GeoJsonResource('id', 'https://example.com/data.json'));
    expect(previewer.requestTransform).toBeUndefined();
  });

  it("is the resource's own transform, unchanged - so a component drawing this preview can apply it to requests the resource doesn't make itself", () => {
    const transform: RequestTransform = () => ({ headers: { Authorization: 'Bearer token' } });
    const resource = new GeoJsonResource('id', 'https://example.com/data.json', undefined, transform);
    const previewer = new GeoJsonPreviewer(resource);

    expect(previewer.requestTransform).toBe(transform);
  });
});
