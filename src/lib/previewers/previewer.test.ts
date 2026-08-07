import { describe, it, expect } from '@stencil/vitest';

import GeoJsonPreviewer from './geojson';
import GeoJsonResource from '../resources/geojson';
import type { RequestTransform } from '../request';

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
