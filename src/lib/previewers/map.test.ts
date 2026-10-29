import { describe, it, expect, beforeEach, afterEach, vi } from '@stencil/vitest';
import type { MapLibreMap } from 'maplibre-gl';

import GeoJsonPreviewer from './geojson';
import XyzPreviewer from './xyz';
import GeoJsonResource from '../resources/geojson';
import XyzResource from '../resources/xyz';
import { defaultBeforeId, type MapLibreStyle } from '../themes/maplibre';

class FakeMap {
  sources = new Map<string, unknown>();
  order: string[];
  errors: string[] = [];

  constructor(basemap: string[]) {
    this.order = [...basemap];
  }

  getSource(id: string) {
    return this.sources.get(id);
  }
  addSource(id: string, spec: unknown) {
    this.sources.set(id, spec);
  }
  removeSource(id: string) {
    this.sources.delete(id);
  }
  getLayer(id: string) {
    return this.order.includes(id) ? { id } : undefined;
  }
  addLayer(layer: { id: string }, beforeId?: string) {
    const index = beforeId ? this.order.indexOf(beforeId) : this.order.length;
    if (index < 0) {
      this.errors.push(`Cannot add layer "${layer.id}" before non-existing layer "${beforeId}".`);
      return;
    }
    this.order.splice(index, 0, layer.id);
  }
  removeLayer(id: string) {
    this.order = this.order.filter(layerId => layerId !== id);
  }
}

const CARTO = ['background', 'roads', 'boundary_country_outline', defaultBeforeId, 'place_labels'];
const OTHER = ['background', 'roads', 'place_labels'];

const style = {
  opacity: 0.8,
  dataColor: '#00f',
  highlightColor: '#0ff',
  selectedColor: '#0f0',
  invalidColor: '#ff0',
  strokeColor: '#009',
  strokeHighlightColor: '#099',
  strokeSelectedColor: '#090',
  strokeInvalidColor: '#990',
  textColor: '#000',
  textFont: 'Noto Sans Regular',
  textSize: 12,
  highlightOpacity: 0.8,
  boundsOpacity: 0.5,
} as MapLibreStyle;

const RASTER = 'ghrsst-xyz';
const TEMPLATE = 'https://example.com/tiles/{z}/{x}/{y}.png';
const xyzPreviewer = () => new XyzPreviewer(new XyzResource('ghrsst', TEMPLATE));

const draw = async <T extends XyzPreviewer | GeoJsonPreviewer>(previewer: T, basemap: string[]) => {
  const map = new FakeMap(basemap);
  previewer.attach(map as unknown as MapLibreMap, style);
  await previewer.preview();
  return map;
};

describe('MapPreviewer#beforeId', () => {
  it("is the first of CARTO's labels unless told otherwise", () => {
    expect(xyzPreviewer().beforeId).toEqual('watername_ocean');
  });

  it("draws the preview underneath it, over everything but the basemap's labels", async () => {
    const map = await draw(xyzPreviewer(), CARTO);

    expect(map.order).toEqual(['background', 'roads', 'boundary_country_outline', RASTER, defaultBeforeId, 'place_labels']);
  });

  it("draws the preview on top of a basemap that has no layer by that name, as though there weren't one", async () => {
    const map = await draw(xyzPreviewer(), OTHER);

    expect(map.order).toEqual([...OTHER, RASTER]);
    expect(map.errors).toEqual([]);
  });

  it('draws the preview on top when told to', async () => {
    const previewer = xyzPreviewer();
    previewer.beforeId = '';
    const map = await draw(previewer, CARTO);

    expect(map.order).toEqual([...CARTO, RASTER]);
  });

  it('goes underneath whichever basemap layer it names', async () => {
    const previewer = xyzPreviewer();
    previewer.beforeId = 'roads';
    const map = await draw(previewer, CARTO);

    expect(map.order).toEqual(['background', RASTER, 'roads', 'boundary_country_outline', defaultBeforeId, 'place_labels']);
  });

  it('asks again of every basemap the preview is drawn into', async () => {
    const previewer = xyzPreviewer();
    await draw(previewer, OTHER);
    const map = await draw(previewer, CARTO);

    expect(map.order).toEqual(['background', 'roads', 'boundary_country_outline', RASTER, defaultBeforeId, 'place_labels']);
  });

  describe('for a preview with labels of its own', () => {
    beforeEach(() => {
      const document: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [30, 2] }, properties: { label: 'Benchmark' } }],
      };
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({ ok: true, status: 200, json: async () => document })),
      );
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    const previewGeoJson = () => draw(new GeoJsonPreviewer(new GeoJsonResource('stanford-geojson', 'https://example.com/data.json')), CARTO);
    const prefix = 'stanford-geojson-geojson-geojson-';
    const ours = (map: FakeMap) => map.order.filter(id => id.startsWith(prefix)).map(id => id.slice(prefix.length));

    it('keeps those on top, where they win out over the basemap labels they collide with', async () => {
      const map = await previewGeoJson();
      const labels = map.order.slice(-3).map(id => id.slice(prefix.length));

      expect(labels).toEqual(['polygon-labels', 'line-labels', 'point-labels']);
    });

    it('draws everything else underneath, in the order the preview draws it in', async () => {
      const map = await previewGeoJson();
      const underneath = map.order.slice(0, map.order.indexOf(defaultBeforeId)).filter(id => id.startsWith(prefix));

      expect(underneath.map(id => id.slice(prefix.length))).toEqual([
        'polygons',
        'polygons-selected',
        'polygon-outlines',
        'polygon-outlines-selected',
        'lines',
        'lines-selected',
        'points',
        'points-selected',
      ]);
      expect(ours(map)).toHaveLength(11);
    });
  });
});
