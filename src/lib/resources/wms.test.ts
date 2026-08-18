/** @vitest-environment happy-dom */
import { describe, it, expect, vi, afterEach } from '@stencil/vitest';
import WmsResource from './wms';
import type { RequestTransform } from '../request';

// The GetMap and GetFeatureInfo URLs are built by protected methods, so expose them for testing.
// A capabilities document is read in rather than fetched, so nothing here touches the network.
class TestWmsSource extends WmsResource {
  private xml?: string;

  withCapabilities(xml: string) {
    this.xml = xml;
    return this;
  }

  async url_for(options: Parameters<TestWmsSource['inspectUrl']>[0]) {
    return new URL(await this.inspectUrl(options));
  }

  map_url() {
    return new URL(this.tilesUrl.split('&bbox=')[0]);
  }

  protected async getMetadata() {
    if (!this.xml) throw new Error('capabilities unavailable');
    return new DOMParser().parseFromString(this.xml, 'application/xml');
  }
}

const ENDPOINT = 'https://geoservices.lib.berkeley.edu/geoserver/wms';

// The part of a capabilities document that lists what GetFeatureInfo can answer with
const capabilities = (formats: string[]) => `<?xml version="1.0" encoding="UTF-8"?>
<WMS_Capabilities xmlns="http://www.opengis.net/wms" version="1.3.0">
  <Capability>
    <Request>
      <GetMap><Format>image/png</Format></GetMap>
      <GetFeatureInfo>${formats.map(format => `<Format>${format}</Format>`).join('')}</GetFeatureInfo>
    </Request>
  </Capability>
</WMS_Capabilities>`;

// The formats ArcGIS Server publishes; notably not the 'application/json' GeoServer answers to
const ARCGIS_FORMATS = ['application/vnd.esri.wms_raw_xml', 'application/geo+json', 'text/xml', 'text/html', 'text/plain'];

const GEOSERVER_FORMATS = ['text/plain', 'application/vnd.ogc.gml', 'application/json', 'text/html'];

// A click in the middle of a 51x51 pixel window over Calaveras County
const options = {
  bbox: '-13416701.09,4600766.56,-13411296.18,4606171.48',
  width: 51,
  height: 51,
  x: 25,
  y: 25,
};

// Skips the format negotiation, which is exercised on its own below
const sourceFor = (overrides = {}) => new TestWmsSource('s7st30', ENDPOINT, { layerIds: [], infoFormat: 'application/json', ...overrides });

describe('WmsSource#tilesUrl', () => {
  it('sends the styles param the spec requires', () => {
    // GeoServer lets it go missing, but ArcGIS refuses the whole request without it
    expect(sourceFor().map_url().searchParams.get('styles')).toEqual('');
  });

  it('lets a caller name the styles to draw with', () => {
    expect(sourceFor({ styles: 'population' }).map_url().searchParams.get('styles')).toEqual('population');
  });
});

describe('WmsSource#inspectUrl', () => {
  it('uses the 1.3.0 param names by default', async () => {
    const params = (await sourceFor().url_for(options)).searchParams;

    expect(params.get('version')).toEqual('1.3.0');

    // 1.3.0 spells these CRS and I,J rather than SRS and X,Y
    expect(params.get('crs')).toEqual('EPSG:3857');
    expect(params.get('i')).toEqual('25');
    expect(params.get('j')).toEqual('25');
    expect(params.get('srs')).toBeNull();
    expect(params.get('x')).toBeNull();
    expect(params.get('y')).toBeNull();
  });

  it('uses the older param names for 1.1.1', async () => {
    const params = (await sourceFor({ version: '1.1.1' }).url_for(options)).searchParams;

    expect(params.get('srs')).toEqual('EPSG:3857');
    expect(params.get('x')).toEqual('25');
    expect(params.get('y')).toEqual('25');
    expect(params.get('crs')).toBeNull();
    expect(params.get('i')).toBeNull();
    expect(params.get('j')).toBeNull();
  });

  it('passes through the query window and asks about the layer', async () => {
    const params = (await sourceFor().url_for(options)).searchParams;

    expect(params.get('request')).toEqual('GetFeatureInfo');
    expect(params.get('bbox')).toEqual(options.bbox);
    expect(params.get('width')).toEqual('51');
    expect(params.get('height')).toEqual('51');

    // Defaults the layer to the source ID, and asks about it rather than just drawing it
    expect(params.get('layers')).toEqual('s7st30');
    expect(params.get('query_layers')).toEqual('s7st30');
  });

  it('sends the styles param the spec requires here too', async () => {
    expect((await sourceFor().url_for(options)).searchParams.get('styles')).toEqual('');
  });

  it('asks for more than the one feature the spec defaults to', async () => {
    const params = (await sourceFor().url_for(options)).searchParams;
    expect(Number(params.get('feature_count'))).toBeGreaterThan(1);
  });

  it('rounds pixel coordinates, which must be integers', async () => {
    const params = (await sourceFor().url_for({ ...options, x: 25.4, y: 25.6 })).searchParams;
    expect(params.get('i')).toEqual('25');
    expect(params.get('j')).toEqual('26');
  });
});

describe('WmsSource#getInfoFormat', () => {
  afterEach(() => vi.restoreAllMocks());

  const infoFormatFor = async (xml?: string) => {
    const source = new TestWmsSource('s7st30', ENDPOINT, { layerIds: [] });
    if (xml) source.withCapabilities(xml);
    return (await source.url_for(options)).searchParams.get('info_format');
  };

  it('picks the OGC-registered spelling ArcGIS is the only one to accept', async () => {
    expect(await infoFormatFor(capabilities(ARCGIS_FORMATS))).toEqual('application/geo+json');
  });

  it('falls back to the older spelling a server publishes instead', async () => {
    expect(await infoFormatFor(capabilities(GEOSERVER_FORMATS))).toEqual('application/json');
  });

  it('asks for GeoJSON anyway when the capabilities cannot be read, rather than not asking', async () => {
    // Reading them is what fails here, and the source says so on the way past
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(await infoFormatFor()).toEqual('application/json');
    expect(warn).toHaveBeenCalled();
  });

  it('asks for GeoJSON anyway when a server publishes none of the spellings', async () => {
    expect(await infoFormatFor(capabilities(['text/html', 'text/plain']))).toEqual('application/json');
  });

  it('lets a caller name the format, skipping the capabilities entirely', async () => {
    const source = new TestWmsSource('s7st30', ENDPOINT, { layerIds: [], infoFormat: 'text/html' });
    expect((await source.url_for(options)).searchParams.get('info_format')).toEqual('text/html');
  });

  it('gives up on the capabilities only once, rather than re-reading them on every click', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const source = new TestWmsSource('s7st30', ENDPOINT, { layerIds: [] });
    let reads = 0;
    (source as any).getMetadata = async () => {
      reads += 1;
      throw new Error('capabilities unavailable');
    };

    await source.url_for(options);
    await source.url_for(options);

    expect(reads).toEqual(1);
  });

  it('reads the capabilities only once', async () => {
    const source = new TestWmsSource('s7st30', ENDPOINT, { layerIds: [] }).withCapabilities(capabilities(ARCGIS_FORMATS));
    let reads = 0;
    const getMetadata = (source as any).getMetadata.bind(source);
    (source as any).getMetadata = async () => {
      reads += 1;
      return await getMetadata();
    };

    await source.url_for(options);
    await source.url_for(options);

    expect(reads).toEqual(1);
  });
});

describe('WmsSource#requestTransform', () => {
  afterEach(() => vi.restoreAllMocks());

  it('applies to the GetFeatureInfo request', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response('{}'));
    const transform: RequestTransform = () => ({ headers: { Authorization: 'Bearer token' } });
    const source = new WmsResource('s7st30', ENDPOINT, { layerIds: [], infoFormat: 'application/json' }, undefined, transform);

    await source.inspect(options);

    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('GetFeatureInfo'), { headers: { Authorization: 'Bearer token' } });
  });

  it('applies to the GetCapabilities request the format negotiation makes', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response(capabilities(GEOSERVER_FORMATS)));
    const transform: RequestTransform = () => ({ headers: { Authorization: 'Bearer token' } });
    const source = new WmsResource('s7st30', ENDPOINT, { layerIds: [] }, undefined, transform);

    await source.inspect(options);

    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('GetCapabilities'), { headers: { Authorization: 'Bearer token' } });
  });
});
