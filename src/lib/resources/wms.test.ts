import { describe, it, expect } from '@stencil/vitest';
import WmsResource from './wms';

// The GetFeatureInfo URL is built by a protected method, so expose it for testing
class TestWmsSource extends WmsResource {
  url_for(options: Parameters<TestWmsSource['inspectUrl']>[0]) {
    return new URL(this.inspectUrl(options));
  }
}

const ENDPOINT = 'https://geoservices.lib.berkeley.edu/geoserver/wms';

// A click in the middle of a 51x51 pixel window over Calaveras County
const options = {
  bbox: '-13416701.09,4600766.56,-13411296.18,4606171.48',
  width: 51,
  height: 51,
  x: 25,
  y: 25,
};

describe('WmsSource#inspectUrl', () => {
  it('uses the 1.3.0 param names by default', () => {
    const source = new TestWmsSource('s7st30', ENDPOINT, { layerIds: [] });
    const params = source.url_for(options).searchParams;

    expect(params.get('version')).toEqual('1.3.0');

    // 1.3.0 spells these CRS and I,J rather than SRS and X,Y
    expect(params.get('crs')).toEqual('EPSG:3857');
    expect(params.get('i')).toEqual('25');
    expect(params.get('j')).toEqual('25');
    expect(params.get('srs')).toBeNull();
    expect(params.get('x')).toBeNull();
    expect(params.get('y')).toBeNull();
  });

  it('uses the older param names for 1.1.1', () => {
    const source = new TestWmsSource('s7st30', ENDPOINT, { layerIds: [], version: '1.1.1' });
    const params = source.url_for(options).searchParams;

    expect(params.get('srs')).toEqual('EPSG:3857');
    expect(params.get('x')).toEqual('25');
    expect(params.get('y')).toEqual('25');
    expect(params.get('crs')).toBeNull();
    expect(params.get('i')).toBeNull();
    expect(params.get('j')).toBeNull();
  });

  it('passes through the query window and asks about the layer', () => {
    const source = new TestWmsSource('s7st30', ENDPOINT, { layerIds: [] });
    const params = source.url_for(options).searchParams;

    expect(params.get('request')).toEqual('GetFeatureInfo');
    expect(params.get('bbox')).toEqual(options.bbox);
    expect(params.get('width')).toEqual('51');
    expect(params.get('height')).toEqual('51');

    // Defaults the layer to the source ID, and asks about it rather than just drawing it
    expect(params.get('layers')).toEqual('s7st30');
    expect(params.get('query_layers')).toEqual('s7st30');
  });

  it('asks for more than the one feature the spec defaults to', () => {
    const source = new TestWmsSource('s7st30', ENDPOINT, { layerIds: [] });
    const params = source.url_for(options).searchParams;
    expect(Number(params.get('feature_count'))).toBeGreaterThan(1);
  });

  it('rounds pixel coordinates, which must be integers', () => {
    const source = new TestWmsSource('s7st30', ENDPOINT, { layerIds: [] });
    const params = source.url_for({ ...options, x: 25.4, y: 25.6 }).searchParams;
    expect(params.get('i')).toEqual('25');
    expect(params.get('j')).toEqual('26');
  });
});
