import { describe, it, expect } from '@stencil/vitest';

import { humanizeLayerName, isLayerDrawn, resolveLayerState, toLayerControlItems, type LayerState, type Layer } from './layers';

const rasterLayer: Layer = {
  id: 'stanford-abc123-xyz',
  title: 'XYZ Tiles',
  defaultOpacity: 0.8,
  styleLayers: [{ id: 'stanford-abc123-xyz', type: 'raster' }],
};

const vectorLayer: Layer = {
  id: 'stanford-abc123-geojson-geojson',
  title: 'GeoJSON',
  defaultOpacity: 0.8,
  styleLayers: [
    { id: 'stanford-abc123-geojson-geojson-polygons', type: 'fill' },
    { id: 'stanford-abc123-geojson-geojson-point-labels', type: 'symbol' },
  ],
};

const scalarLayer: Layer = {
  id: 'stanford-def456-cog',
  title: 'Groundwater Elevation',
  defaultOpacity: 0.8,
  styleLayers: [{ id: 'stanford-def456-cog', type: 'custom' }],
  defaultColorRamp: 'viridis',
  colorRampRange: [-184.48, 607.27],
};

const scanLayer: Layer = {
  id: 'stanford-bb013fz9675-georeference',
  title: 'Georeferenced map',
  defaultOpacity: 0.8,
  styleLayers: [{ id: 'stanford-bb013fz9675-georeference', type: 'custom' }],
  backgroundRemovable: true,
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
  it('follows the theme for a row the user has not touched, whatever kind of data it is', () => {
    expect(resolveLayerState(rasterLayer, new Map())).toEqual({ visible: true, opacity: 0.8, removeBackground: false });
    expect(resolveLayerState(vectorLayer, new Map())).toEqual({ visible: true, opacity: 0.8, removeBackground: false });
  });

  it('prefers what the user asked for', () => {
    const states = new Map<string, LayerState>([[rasterLayer.id, { visible: false, opacity: 0.25 }]]);
    expect(resolveLayerState(rasterLayer, states)).toEqual({ visible: false, opacity: 0.25, removeBackground: false });
  });

  it('does not let the state of one row leak into another', () => {
    const states = new Map<string, LayerState>([[rasterLayer.id, { visible: false, opacity: 0.25 }]]);
    expect(resolveLayerState(vectorLayer, states)).toEqual({ visible: true, opacity: 0.8, removeBackground: false });
  });

  it("follows the layer's own ramp for a rampable row the user has not touched", () => {
    expect(resolveLayerState(scalarLayer, new Map())).toEqual({ visible: true, opacity: 0.8, colorRamp: 'viridis', removeBackground: false });
  });

  it('prefers the ramp the user chose', () => {
    const states = new Map<string, LayerState>([[scalarLayer.id, { visible: true, opacity: 0.8, colorRamp: 'magma' }]]);
    expect(resolveLayerState(scalarLayer, states).colorRamp).toEqual('magma');
  });

  it("prefers the reader's choice about the background", () => {
    const states = new Map<string, LayerState>([[scanLayer.id, { visible: true, opacity: 0.8, removeBackground: true }]]);
    expect(resolveLayerState(scanLayer, states).removeBackground).toBe(true);
  });

  it('leaves the background alone for a removable row the user has not touched', () => {
    expect(resolveLayerState(scanLayer, new Map()).removeBackground).toBe(false);
  });

  it("falls back to the layer's own ramp when the state on record has none", () => {
    const states = new Map<string, LayerState>([[scalarLayer.id, { visible: true, opacity: 0.4 }]]);
    expect(resolveLayerState(scalarLayer, states).colorRamp).toEqual('viridis');
  });
});

describe('isLayerDrawn', () => {
  it('is true only for a row that is both shown and not fully faded', () => {
    expect(isLayerDrawn({ visible: true, opacity: 0.8 })).toBe(true);
    expect(isLayerDrawn({ visible: false, opacity: 0.8 })).toBe(false);
  });

  it('treats a row faded to zero as off the map', () => {
    expect(isLayerDrawn({ visible: true, opacity: 0 })).toBe(false);
  });
});

describe('toLayerControlItems', () => {
  it('preserves the order the previewer published, which is paint order', () => {
    const items = toLayerControlItems([rasterLayer, vectorLayer], new Map());
    expect(items.map(item => item.id)).toEqual([rasterLayer.id, vectorLayer.id]);
  });

  it('emits only scalars, so the panel never holds a style spec', () => {
    const [item] = toLayerControlItems([vectorLayer], new Map());

    expect(item).toEqual({ id: 'stanford-abc123-geojson-geojson', title: 'GeoJSON', visible: true, opacity: 0.8 });
    expect(Object.keys(item).sort()).toEqual(['id', 'opacity', 'title', 'visible']);
  });

  it('reflects what the user asked for', () => {
    const states = new Map<string, LayerState>([[vectorLayer.id, { visible: false, opacity: 0.4 }]]);
    const [item] = toLayerControlItems([vectorLayer], states);

    expect(item.visible).toBe(false);
    expect(item.opacity).toEqual(0.4);
  });

  it('carries a ramp and its range only for a layer that has one', () => {
    const [scalar] = toLayerControlItems([scalarLayer], new Map());
    expect(scalar).toEqual({ id: scalarLayer.id, title: 'Groundwater Elevation', visible: true, opacity: 0.8, colorRamp: 'viridis', colorRampRange: [-184.48, 607.27] });

    const [vector] = toLayerControlItems([vectorLayer], new Map());
    expect(Object.keys(vector).sort()).toEqual(['id', 'opacity', 'title', 'visible']);
  });

  it('carries what the values measure for a layer whose metadata says', () => {
    const quantity = { name: 'Elevation', unit: 'meters', datum: 'North American Vertical Datum of 1988' };
    const [scalar] = toLayerControlItems([{ ...scalarLayer, quantity }], new Map());
    expect(scalar.quantity).toEqual(quantity);

    const [unsaid] = toLayerControlItems([scalarLayer], new Map());
    expect(unsaid).not.toHaveProperty('quantity');
  });

  it('carries the background toggle only for a layer whose background can be removed', () => {
    const [scan] = toLayerControlItems([scanLayer], new Map());
    expect(scan).toEqual({ id: scanLayer.id, title: 'Georeferenced map', visible: true, opacity: 0.8, removeBackground: false });

    const [undetected] = toLayerControlItems([{ ...scanLayer, backgroundRemovable: undefined }], new Map());
    expect(Object.keys(undetected).sort()).toEqual(['id', 'opacity', 'title', 'visible']);
  });

  it('carries legend pictures only for a layer whose service publishes them', () => {
    const legendImages = [{ url: 'https://gibs.earthdata.nasa.gov/legends/GHRSST_Sea_Surface_Temperature_H.svg', width: 378, height: 86 }];
    const [wmts] = toLayerControlItems([{ ...rasterLayer, legendImages }], new Map());
    expect(wmts).toEqual({ id: rasterLayer.id, title: 'XYZ Tiles', visible: true, opacity: 0.8, legendImages });

    const [raster] = toLayerControlItems([rasterLayer], new Map());
    expect(Object.keys(raster).sort()).toEqual(['id', 'opacity', 'title', 'visible']);
  });

  it('reflects a background the reader has already taken off', () => {
    const states = new Map<string, LayerState>([[scanLayer.id, { visible: true, opacity: 0.8, removeBackground: true }]]);
    expect(toLayerControlItems([scanLayer], states)[0].removeBackground).toBe(true);
  });
});
