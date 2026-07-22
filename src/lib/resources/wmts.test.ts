/** @vitest-environment happy-dom */
import { describe, it, expect } from '@stencil/vitest';
import { LngLatBounds, type LngLatBoundsLike } from 'maplibre-gl';
import WmtsResource, { type WmtsOptions } from './wmts';

const ENDPOINT = 'https://example.org/wmts/1.0.0/WMTSCapabilities.xml';

// Reads a hand-built capabilities document instead of fetching one
class TestWmtsResource extends WmtsResource {
  private xml: string;

  constructor(id: string, url: string, options: WmtsOptions, xml: string, bounds?: LngLatBoundsLike) {
    super(id, url, options, bounds);
    this.xml = xml;
  }

  protected async getMetadata() {
    return new DOMParser().parseFromString(this.xml, 'application/xml');
  }
}

// One zoom of the XYZ grid: 2^z square tiles hung from the northwest corner of the world
const mercatorLevel = (zoom: number, { prefix = '', tileSize = 256 } = {}) => `
  <TileMatrix>
    <ows:Identifier>${prefix}${zoom}</ows:Identifier>
    <TopLeftCorner>-20037508.34278925 20037508.34278925</TopLeftCorner>
    <TileWidth>${tileSize}</TileWidth>
    <TileHeight>${tileSize}</TileHeight>
    <MatrixWidth>${2 ** zoom}</MatrixWidth>
    <MatrixHeight>${2 ** zoom}</MatrixHeight>
  </TileMatrix>`;

// Tiles per side at each zoom of NASA GIBS' geographic "500m" grid, which halves down from
// 160x80 tiles of 2.25 degrees and rounds up - so it is neither square nor a quadtree
const GEOGRAPHIC_LEVELS = [
  [2, 1],
  [3, 2],
  [5, 3],
  [10, 5],
];

const geographicLevel = (zoom: number) => `
  <TileMatrix>
    <ows:Identifier>${zoom}</ows:Identifier>
    <TopLeftCorner>-180 90</TopLeftCorner>
    <TileWidth>512</TileWidth>
    <TileHeight>512</TileHeight>
    <MatrixWidth>${GEOGRAPHIC_LEVELS[zoom][0]}</MatrixWidth>
    <MatrixHeight>${GEOGRAPHIC_LEVELS[zoom][1]}</MatrixHeight>
  </TileMatrix>`;

const tileMatrixSet = (id: string, crs: string, levels: string) => `
  <TileMatrixSet>
    <ows:Identifier>${id}</ows:Identifier>
    <ows:SupportedCRS>${crs}</ows:SupportedCRS>
    ${levels}
  </TileMatrixSet>`;

const ZOOMS = [0, 1, 2, 3];

const MERCATOR_SET = tileMatrixSet('GoogleMapsCompatible_Level3', 'urn:ogc:def:crs:EPSG:6.18:3:3857', ZOOMS.map(zoom => mercatorLevel(zoom)).join(''));

const GEOGRAPHIC_SET = tileMatrixSet('500m', 'urn:ogc:def:crs:OGC:1.3:CRS84', ZOOMS.map(geographicLevel).join(''));

// GeoServer and friends qualify the level with the grid it belongs to
const QUALIFIED_SET = tileMatrixSet('EPSG:900913', 'EPSG:900913', ZOOMS.map(zoom => mercatorLevel(zoom, { prefix: 'EPSG:900913:' })).join(''));

// Web Mercator, but with a level that doesn't hold the 2^z by 2^z tiles that zoom has
const RAGGED_SET = tileMatrixSet(
  'ragged',
  'EPSG:3857',
  `${mercatorLevel(0)}
   <TileMatrix>
     <ows:Identifier>1</ows:Identifier>
     <TopLeftCorner>-20037508.34278925 20037508.34278925</TopLeftCorner>
     <TileWidth>256</TileWidth>
     <TileHeight>256</TileHeight>
     <MatrixWidth>3</MatrixWidth>
     <MatrixHeight>2</MatrixHeight>
   </TileMatrix>`,
);

const TIME_DIMENSION = `
  <Dimension>
    <ows:Identifier>Time</ows:Identifier>
    <UOM>ISO8601</UOM>
    <Default>2016-01-01</Default>
  </Dimension>`;

const TILE_TEMPLATE = 'https://tiles.example.org/lights/{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.png';

const boundingBox = (west: number, south: number, east: number, north: number) => `
  <ows:WGS84BoundingBox crs="urn:ogc:def:crs:OGC:2:84">
    <ows:LowerCorner>${west} ${south}</ows:LowerCorner>
    <ows:UpperCorner>${east} ${north}</ows:UpperCorner>
  </ows:WGS84BoundingBox>`;

type LayerOptions = { id?: string; links: string[]; templates?: string[]; dimension?: string; extraUrls?: string; bbox?: string };

const layer = ({ id = 'lights', links, templates = [TILE_TEMPLATE], dimension = '', extraUrls = '', bbox = '' }: LayerOptions) => `
  <Layer>
    <ows:Title>Night Lights</ows:Title>
    ${bbox}
    <ows:Identifier>${id}</ows:Identifier>
    <Style isDefault="true"><ows:Identifier>default</ows:Identifier></Style>
    ${dimension}
    ${links.map(link => `<TileMatrixSetLink><TileMatrixSet>${link}</TileMatrixSet></TileMatrixSetLink>`).join('')}
    ${templates.map(template => `<ResourceURL resourceType="tile" format="image/png" template="${template}"/>`).join('')}
    ${extraUrls}
  </Layer>`;

const capabilities = (...contents: string[]) => `<?xml version="1.0" encoding="UTF-8"?>
<Capabilities xmlns="http://www.opengis.net/wmts/1.0" xmlns:ows="http://www.opengis.net/ows/1.1" version="1.0.0">
  <Contents>${contents.join('')}</Contents>
</Capabilities>`;

const resourceFor = (xml: string, layerIds = ['lights'], url = ENDPOINT, bounds?: LngLatBoundsLike) => new TestWmtsResource('night-lights', url, { layerIds }, xml, bounds);

describe('WmtsResource#getLayers', () => {
  it('rewrites a Web Mercator layer as XYZ tile URLs', async () => {
    const resource = resourceFor(capabilities(layer({ links: ['GoogleMapsCompatible_Level3'] }), MERCATOR_SET));
    const [drawn] = await resource.getLayers();

    expect(drawn.id).toEqual('lights');
    expect(drawn.title).toEqual('Night Lights');
    expect(drawn.tileUrls).toEqual(['https://tiles.example.org/lights/default/GoogleMapsCompatible_Level3/{z}/{y}/{x}.png']);
  });

  it('takes the tile size and zoom range from the tile matrix set', async () => {
    const bigTiles = tileMatrixSet('big', 'EPSG:3857', [2, 3].map(zoom => mercatorLevel(zoom, { tileSize: 512 })).join(''));
    const resource = resourceFor(capabilities(layer({ links: ['big'] }), bigTiles));
    const [drawn] = await resource.getLayers();

    // Both differ from what MapLibre would assume on its own, which is 512px tiles over zooms 0-22
    expect(drawn.tileSize).toEqual(512);
    expect(drawn.minzoom).toEqual(2);
    expect(drawn.maxzoom).toEqual(3);
  });

  it('substitutes the default value of each dimension', async () => {
    const template = 'https://tiles.example.org/lights/default/{Time}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.png';
    const resource = resourceFor(capabilities(layer({ links: ['GoogleMapsCompatible_Level3'], templates: [template], dimension: TIME_DIMENSION }), MERCATOR_SET));
    const [drawn] = await resource.getLayers();

    expect(drawn.tileUrls).toEqual(['https://tiles.example.org/lights/default/2016-01-01/GoogleMapsCompatible_Level3/{z}/{y}/{x}.png']);
  });

  it('ignores resource URLs that serve something other than tiles', async () => {
    const extraUrls = '<ResourceURL resourceType="Domains" format="text/xml" template="https://tiles.example.org/lights/domains/{TileMatrixSet}/all.xml"/>';
    const resource = resourceFor(capabilities(layer({ links: ['GoogleMapsCompatible_Level3'], extraUrls }), MERCATOR_SET));
    const [drawn] = await resource.getLayers();

    expect(drawn.tileUrls).toHaveLength(1);
  });

  it('keeps the prefix on tile matrix identifiers that are qualified by their grid', async () => {
    const resource = resourceFor(capabilities(layer({ links: ['EPSG:900913'] }), QUALIFIED_SET));
    const [drawn] = await resource.getLayers();

    expect(drawn.tileUrls).toEqual(['https://tiles.example.org/lights/default/EPSG:900913/EPSG:900913:{z}/{y}/{x}.png']);
  });

  it('passes over a grid it cannot draw for one it can, whatever the order', async () => {
    const resource = resourceFor(capabilities(layer({ links: ['500m', 'GoogleMapsCompatible_Level3'] }), GEOGRAPHIC_SET, MERCATOR_SET));
    const [drawn] = await resource.getLayers();

    expect(drawn.tileUrls).toEqual(['https://tiles.example.org/lights/default/GoogleMapsCompatible_Level3/{z}/{y}/{x}.png']);
  });

  it('refuses a layer published only in a geographic grid, naming the grid and its CRS', async () => {
    const resource = resourceFor(capabilities(layer({ links: ['500m'] }), GEOGRAPHIC_SET));

    // Tile indices in a geographic grid address different ground than MapLibre's XYZ ones,
    // so drawing it would put imagery in the wrong place or fall off the end of a row
    await expect(resource.getLayers()).rejects.toThrow('500m (urn:ogc:def:crs:OGC:1.3:CRS84)');
    await expect(resource.getLayers()).rejects.toThrow(/Web Mercator/);
  });

  it('refuses a Web Mercator grid whose levels are not the XYZ ones', async () => {
    const resource = resourceFor(capabilities(layer({ links: ['ragged'] }), RAGGED_SET));
    await expect(resource.getLayers()).rejects.toThrow('ragged (EPSG:3857)');
  });

  it('refuses a layer the service does not publish', async () => {
    const resource = resourceFor(capabilities(layer({ links: ['GoogleMapsCompatible_Level3'] }), MERCATOR_SET), ['moonlight']);
    await expect(resource.getLayers()).rejects.toThrow('moonlight');
  });

  it('returns only the requested layer when the service lists many', async () => {
    const others = [1, 2, 3].map(index => layer({ id: `other-${index}`, links: ['GoogleMapsCompatible_Level3'] })).join('');
    const resource = resourceFor(capabilities(others, layer({ links: ['GoogleMapsCompatible_Level3'] }), MERCATOR_SET));
    const drawn = await resource.getLayers();

    expect(drawn.map(each => each.id)).toEqual(['lights']);
  });
});

// Deep enough to hold the zoom a city-sized layer starts at
const DEEP_SET = tileMatrixSet('GoogleMapsCompatible', 'EPSG:3857', Array.from({ length: 20 }, (_, zoom) => mercatorLevel(zoom)).join(''));

// Vienna, as its orthophoto service states it, and as the Aardvark record does
const VIENNA = boundingBox(16.17, 48.1, 16.58, 48.33);
// Built the way bboxToBounds builds it from a record's ENVELOPE, since that is what arrives here
const VIENNA_RECORD = new LngLatBounds([16.133423, 48.106056], [16.626434, 48.3348]);

const boundedLayers = (bbox: string, grid = DEEP_SET, id = 'GoogleMapsCompatible', bounds?: LngLatBoundsLike) =>
  resourceFor(capabilities(layer({ links: [id], bbox }), grid), ['lights'], ENDPOINT, bounds).getLayers();

describe('WmtsResource#getLayers extent', () => {
  it('carries the published bounding box through in MapLibre order', async () => {
    const [drawn] = await boundedLayers(VIENNA);

    expect(drawn.bounds).toEqual([16.17, 48.1, 16.58, 48.33]);
  });

  it('starts a city-sized layer at the zoom where it first fills a tile', async () => {
    // Below this every tile is mostly outside the layer, and a service that draws the empty
    // part rather than answering 404 paints it over the map
    const [drawn] = await boundedLayers(VIENNA);

    expect(drawn.minzoom).toEqual(10);
    expect(drawn.maxzoom).toEqual(19);
  });

  it('leaves a layer that covers the world at the first zoom of its grid', async () => {
    const [drawn] = await boundedLayers(boundingBox(-180, -90, 180, 90));

    expect(drawn.minzoom).toEqual(0);
  });

  it('measures a bounding box that crosses the antimeridian the short way round', async () => {
    // Two degrees of longitude at the date line, not the 358 that subtracting the corners gives
    const [drawn] = await boundedLayers(boundingBox(179, -0.1, -179, 0.1));

    expect(drawn.minzoom).toEqual(8);
  });

  it('never starts a layer past the end of its grid', async () => {
    const [drawn] = await boundedLayers(boundingBox(16.4, 48.2, 16.4, 48.2), MERCATOR_SET, 'GoogleMapsCompatible_Level3');

    expect(drawn.minzoom).toEqual(3);
    expect(drawn.maxzoom).toEqual(3);
  });

  it('falls back to the extent on the record when the service publishes none', async () => {
    const [drawn] = await boundedLayers('', DEEP_SET, 'GoogleMapsCompatible', VIENNA_RECORD);

    expect(drawn.bounds).toEqual([16.133423, 48.106056, 16.626434, 48.3348]);
    expect(drawn.minzoom).toEqual(10);
  });

  it('prefers the extent the service publishes to the one on the record', async () => {
    // The record states one extent for everything it references; the service states one per layer
    const [drawn] = await boundedLayers(VIENNA, DEEP_SET, 'GoogleMapsCompatible', [-180, -85, 180, 85]);

    expect(drawn.bounds).toEqual([16.17, 48.1, 16.58, 48.33]);
    expect(drawn.minzoom).toEqual(10);
  });

  it('leaves the extent unset when neither the service nor the record gives one', async () => {
    const [drawn] = await boundedLayers('');

    expect(drawn.bounds).toBeUndefined();
    expect(drawn.minzoom).toEqual(0);
  });
});

// Vienna's service, in miniature: tiles sharded over several hosts, only one of which is the
// host that answered the capabilities request, and every one of them advertised over http
const SHARDED_TEMPLATES = ['maps1', 'maps2', 'maps'].map(host => `http://${host}.example.org/lb2016/{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.jpeg`);

const shardedLayers = (url: string, templates = SHARDED_TEMPLATES) =>
  resourceFor(capabilities(layer({ links: ['GoogleMapsCompatible_Level3'], templates }), MERCATOR_SET), ['lights'], url).getLayers();

describe('WmtsResource#getLayers tile hosts', () => {
  it('keeps only the host that served the capabilities document', async () => {
    // MapLibre assigns each tile to a host by coordinate and never retries elsewhere, so a
    // hostname that no longer resolves costs us that share of the tiles for good
    const [drawn] = await shardedLayers('https://maps.example.org/wmts/1.0.0/WMTSCapabilities.xml');

    expect(drawn.tileUrls).toEqual(['https://maps.example.org/lb2016/default/GoogleMapsCompatible_Level3/{z}/{y}/{x}.jpeg']);
  });

  it('reaches that host over https when that is how the capabilities came back', async () => {
    // A document served over https can still advertise http tiles, which the browser blocks
    // as mixed content
    const [drawn] = await shardedLayers('https://maps.example.org/wmts/1.0.0/WMTSCapabilities.xml');

    expect(drawn.tileUrls[0].startsWith('https://')).toBe(true);
  });

  it('leaves every host in place when none of them served the capabilities', async () => {
    const [drawn] = await shardedLayers('https://www.example.org/wmts/1.0.0/WMTSCapabilities.xml');

    expect(drawn.tileUrls).toHaveLength(3);
    expect(drawn.tileUrls[0]).toContain('http://maps1.example.org/');
  });

  it('never downgrades a tile host that already speaks https', async () => {
    const templates = ['https://maps.example.org/lb2016/{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.jpeg'];
    const [drawn] = await shardedLayers('http://maps.example.org/wmts/1.0.0/WMTSCapabilities.xml', templates);

    expect(drawn.tileUrls[0].startsWith('https://')).toBe(true);
  });

  it('leaves a service whose tiles live on a host of their own alone', async () => {
    const [drawn] = await resourceFor(capabilities(layer({ links: ['GoogleMapsCompatible_Level3'] }), MERCATOR_SET)).getLayers();

    expect(drawn.tileUrls).toEqual(['https://tiles.example.org/lights/default/GoogleMapsCompatible_Level3/{z}/{y}/{x}.png']);
  });
});
