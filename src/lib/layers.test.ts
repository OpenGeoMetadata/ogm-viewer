import { describe, it, expect } from '@stencil/vitest';

import { humanizeLayerName, resolveLayerState, toLayerControlItems, type LayerState, type PreviewLayer } from './layers';

const rasterLayer: PreviewLayer = {
  id: 'stanford-abc123-xyz',
  title: 'XYZ Tiles',
  defaultOpacity: 0.8,
  styleLayers: [{ id: 'stanford-abc123-xyz', type: 'raster' }],
};

const vectorLayer: PreviewLayer = {
  id: 'stanford-abc123-geojson-geojson',
  title: 'GeoJSON',
  defaultOpacity: 1,
  styleLayers: [
    { id: 'stanford-abc123-geojson-geojson-polygons', type: 'fill' },
    { id: 'stanford-abc123-geojson-geojson-point-labels', type: 'symbol' },
  ],
};

describe('humanizeLayerName', () => {
  it('turns a machine-written tileset name into a readable one', () => {
    expect(humanizeLayerName('landuse_overlay')).toEqual('Landuse overlay');
  });

  it('leaves a name that is already readable alone', () => {
    expect(humanizeLayerName('Orthofoto 2016 Wien')).toEqual('Orthofoto 2016 Wien');
  });

  it('keeps hyphens, which the publisher wrote deliberately', () => {
    expect(humanizeLayerName('built-up')).toEqual('Built-up');
  });

  it('returns the original when there is nothing to humanize', () => {
    expect(humanizeLayerName('')).toEqual('');
    expect(humanizeLayerName('   ')).toEqual('   ');
  });
});

describe('resolveLayerState', () => {
  it('follows the theme for a row the reader has not touched', () => {
    expect(resolveLayerState(rasterLayer, new Map())).toEqual({ visible: true, opacity: 0.8 });
    expect(resolveLayerState(vectorLayer, new Map())).toEqual({ visible: true, opacity: 1 });
  });

  it('prefers what the reader asked for', () => {
    const states = new Map<string, LayerState>([[rasterLayer.id, { visible: false, opacity: 0.25 }]]);
    expect(resolveLayerState(rasterLayer, states)).toEqual({ visible: false, opacity: 0.25 });
  });

  it('does not let the state of one row leak into another', () => {
    const states = new Map<string, LayerState>([[rasterLayer.id, { visible: false, opacity: 0.25 }]]);
    expect(resolveLayerState(vectorLayer, states)).toEqual({ visible: true, opacity: 1 });
  });
});

describe('toLayerControlItems', () => {
  it('preserves the order the previewer published, which is paint order', () => {
    const items = toLayerControlItems([rasterLayer, vectorLayer], new Map());
    expect(items.map(item => item.id)).toEqual([rasterLayer.id, vectorLayer.id]);
  });

  it('emits only scalars, so the panel never holds a style spec', () => {
    const [item] = toLayerControlItems([vectorLayer], new Map());

    expect(item).toEqual({ id: 'stanford-abc123-geojson-geojson', title: 'GeoJSON', visible: true, opacity: 1 });
    expect(Object.keys(item).sort()).toEqual(['id', 'opacity', 'title', 'visible']);
  });

  it('reflects what the reader asked for', () => {
    const states = new Map<string, LayerState>([[vectorLayer.id, { visible: false, opacity: 0.4 }]]);
    const [item] = toLayerControlItems([vectorLayer], states);

    expect(item.visible).toBe(false);
    expect(item.opacity).toEqual(0.4);
  });
});
