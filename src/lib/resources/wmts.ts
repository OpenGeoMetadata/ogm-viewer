import { LngLatBounds, type LngLatBoundsLike, type RasterSourceSpecification } from 'maplibre-gl';
import RasterResource from './raster';

export type WmtsOptions = {
  layerIds: string[];
  tileSize?: number;
};

// [west, south, east, north], the order MapLibre wants a source's bounds in
export type Bounds = NonNullable<RasterSourceSpecification['bounds']>;

// Spec for a single layer that will generate a matching MapLibre source/layer
export type WmtsLayer = {
  id: string;
  title: string;
  tileUrls: string[];
  tileSize: number;
  minzoom: number;
  maxzoom: number;
  bounds?: Bounds;
};

// What MapLibre needs to know about a tile grid in order to draw from it
type XyzGrid = {
  tileSize: number;
  minzoom: number;
  maxzoom: number;
  // TileMatrix identifiers are usually the bare zoom level, but some servers qualify them
  // ("EPSG:900913:5"); whatever precedes the level has to go back into the URL template
  levelPrefix: string;
};

// A <TileMatrixSet> definition. `grid` is filled in only for the sets MapLibre can draw;
// the others are kept so we can report what a layer offered when none of it is usable.
type TileMatrixSet = {
  id: string;
  crs: string;
  grid?: XyzGrid;
};

// A single <TileMatrix> (one zoom level) within a set
type TileMatrix = {
  zoom: number;
  prefix: string;
  tileWidth: number;
  tileHeight: number;
  matrixWidth: number;
  matrixHeight: number;
  topLeft: number[];
};

// Half the circumference of the Web Mercator world in meters. The XYZ grid hangs from
// (-XYZ_ORIGIN, XYZ_ORIGIN), the northwest corner of the world.
const XYZ_ORIGIN = 20037508.342789244;

// How far a set's stated origin may sit from that corner and still count as the same grid.
// Services round the value to varying precision; half a meter is far below one pixel at any
// zoom a WMTS publishes.
const ORIGIN_TOLERANCE = 0.5;

// Codes that all mean Web Mercator: the EPSG one, the deprecated OGC one, and the ESRI one
const WEB_MERCATOR_CODES = ['3857', '900913', '102100'];

// The latitude the Web Mercator world stops at. A layer may claim an extent that runs to the
// pole, but there is no map there to bound it against.
const MERCATOR_MAX_LATITUDE = 85.051129;

// Layers (potentially multiple) accessed via WMTS GetTile requests
// NOTE: in Aardvark, the reference URL is the GetCapabilities URL, not the tile URL
export default class WmtsResource extends RasterResource {
  private options: WmtsOptions;

  // Memoized metadata via GetCapabilities request
  private metadata: Document;

  constructor(id: string, url: string, options: WmtsOptions, bounds?: LngLatBoundsLike) {
    super(id, url, bounds);
    this.options = options;

    // Assume we're using one layer with the given ID if no layer IDs are provided
    if (!this.options.layerIds || this.options.layerIds.length === 0) {
      this.options.layerIds = [id];
    }
  }

  label() {
    return 'Web Map Tile Service (WMTS)';
  }

  // Fetch and memoize WMTS GetCapabilities XML document
  protected async getMetadata() {
    if (!this.metadata) {
      const resp = await fetch(this.url);
      const text = await resp.text();
      this.metadata = new DOMParser().parseFromString(text, 'application/xml');
    }
    return this.metadata;
  }

  // Build a spec for each layer we were asked for. Layers published only in tile grids
  // MapLibre can't draw are dropped, and if that leaves nothing we raise rather than
  // hand back an empty preview.
  async getLayers(): Promise<WmtsLayer[]> {
    const metadata = await this.getMetadata();
    const tileMatrixSets = this.getTileMatrixSets(metadata);

    // Narrow to the requested layers before building anything: a service like NASA GIBS
    // lists close to a thousand, and each one costs a walk of its subtree.
    const elements = Array.from(metadata.getElementsByTagName('Layer')).filter(element => this.isRequested(element));
    if (elements.length === 0) throw new Error(`This service doesn't publish a layer named ${this.options.layerIds.join(', ')}.`);

    const layers = elements.map(element => this.createLayer(element, tileMatrixSets)).filter(layer => layer !== undefined);
    if (layers.length === 0) throw new Error(this.unsupportedGridMessage(elements, tileMatrixSets));

    return layers;
  }

  // Whether a <Layer> element is one of the layers this resource was constructed for.
  // An empty list means every layer in the document, which can be a lot of them.
  protected isRequested(element: Element): boolean {
    if (this.options.layerIds.length === 0) return true;
    const layerId = element.getElementsByTagName('ows:Identifier')[0]?.textContent?.trim();
    return this.options.layerIds.includes(layerId ?? '');
  }

  // Create a WmtsLayer spec from a <Layer> element in the GetCapabilities document, or
  // undefined if none of the grids it's published in can be drawn
  protected createLayer(element: Element, tileMatrixSets: Map<string, TileMatrixSet>): WmtsLayer | undefined {
    // Get the identifier and title of the layer
    const layerId = element.getElementsByTagName('ows:Identifier')[0]?.textContent;
    const title = element.getElementsByTagName('ows:Title')[0]?.textContent;

    // Get the identifier of the style with attribute isDefault="true", or the first style if none are marked as default
    const styles = Array.from(element.getElementsByTagName('Style'));
    const defaultStyle = styles.find(style => style.getAttribute('isDefault') === 'true');
    const style = defaultStyle ?? styles[0];
    const styleId = style?.getElementsByTagName('ows:Identifier')[0]?.textContent?.trim();

    // Use the first grid the layer offers that MapLibre can actually draw, which is not
    // necessarily the first one listed: services often lead with a national grid
    const tileMatrixSet = this.getLinkedTileMatrixSets(element, tileMatrixSets).find(set => set.grid);
    const grid = tileMatrixSet?.grid;
    if (!tileMatrixSet || !grid) return undefined;

    // Get the default values for all dimensions listed for the layer
    // TODO: actually support adjusting these in the previewer?
    const dimensions = Array.from(element.getElementsByTagName('Dimension'));
    const dimensionDefaults = dimensions.reduce(
      (acc, dimension) => {
        const name = dimension.getElementsByTagName('ows:Identifier')[0]?.textContent?.trim();
        const defaultValue = dimension.getElementsByTagName('Default')[0]?.textContent?.trim();
        if (name && defaultValue) {
          acc[name] = defaultValue;
        }
        return acc;
      },
      {} as Record<string, string>,
    );

    // For each tiled ResourceURL, reformat as XYZ-style URL
    // Each MapLibre layer will be tied to a MapLibre source with multiple tile URLs
    const templates = Array.from(element.getElementsByTagName('ResourceURL'))
      .filter(resourceUrl => resourceUrl.getAttribute('resourceType') === 'tile')
      .map(resourceUrl => resourceUrl.getAttribute('template') ?? '');

    const tileUrls = this.preferKnownHost(templates).map(template => this.formatTileUrl(template, styleId, tileMatrixSet, dimensionDefaults));

    const bounds = this.parseBounds(element) ?? this.recordBounds();

    return {
      id: layerId,
      title: title,
      tileUrls: tileUrls,
      tileSize: this.options.tileSize ?? grid.tileSize,
      minzoom: clamp(this.boundsMinzoom(bounds), grid.minzoom, grid.maxzoom),
      maxzoom: grid.maxzoom,
      bounds: bounds,
    };
  }

  // The extent the layer covers, from its <ows:WGS84BoundingBox>. OWS writes both corners as
  // "longitude latitude" in CRS84 whatever axis order the layer's own CRS uses, so the numbers
  // come out in MapLibre's order as they are read.
  protected parseBounds(element: Element): Bounds | undefined {
    const box = element.getElementsByTagName('ows:WGS84BoundingBox')[0];
    if (!box) return undefined;

    const [west, south] = numericCorner(box, 'ows:LowerCorner');
    const [east, north] = numericCorner(box, 'ows:UpperCorner');
    if ([west, south, east, north].some(value => !Number.isFinite(value))) return undefined;

    return [west, south, east, north];
  }

  // The extent the record claims, for a service that publishes none of its own. Aardvark states
  // it per record rather than per layer, so it's the coarser of the two, but it still keeps us
  // from treating a city as if it covered the world.
  protected recordBounds(): Bounds | undefined {
    if (!this.bounds) return undefined;

    const bounds = LngLatBounds.convert(this.bounds);
    return [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
  }

  // The first zoom at which a single tile no longer dwarfs the layer. Below it every tile we
  // could ask for lies mostly outside the layer, and a service that draws that emptiness
  // instead of answering 404 - Vienna's orthophoto pads it with opaque white, JPEG having no
  // alpha channel to leave it out with - spreads the padding across the map: at zoom 1 the one
  // tile that touches Vienna covers a quarter of the world. Bounds alone don't help, since
  // MapLibre keeps any tile that so much as intersects them. A tile spans 1/2^z of the world
  // on each axis, so the layer first fills one when 2^z reaches 1 over its widest extent.
  protected boundsMinzoom(bounds: Bounds | undefined): number {
    if (!bounds) return 0;

    const [west, south, east, north] = bounds;
    const width = east < west ? east - west + 360 : east - west;
    const extent = Math.max(width / 360, mercatorY(south) - mercatorY(north));

    // An extent of nothing is a layer we can never fit a tile to; let the caller's clamp put it
    // at the deepest zoom the grid has rather than the shallowest
    if (!(extent > 0)) return Infinity;

    return Math.ceil(Math.log2(1 / extent));
  }

  // Narrow the tile templates to the host we know answers. Services list several hosts to
  // shard requests across, but MapLibre assigns each tile to one of them by coordinate -
  // urls[(x + y) % urls.length] - and never retries elsewhere, so one stale hostname
  // silently costs that share of the tiles. The host that served the capabilities document
  // is the one we have evidence for: it resolved, answered, and allowed the cross-origin
  // read. Where any template is on that host we keep only those, and upgrade them to https
  // if that's how we reached it, since a document served over https can still advertise its
  // tiles over http - which the browser then blocks as mixed content. Sharding buys little
  // over HTTP/2 anyway, where the whole point of it, the per-origin connection limit, is gone.
  protected preferKnownHost(templates: string[]): string[] {
    const capabilities = new URL(this.url);
    const known = templates.filter(template => hostOf(template) === capabilities.host);
    if (known.length === 0) return templates;
    if (capabilities.protocol !== 'https:') return known;

    return known.map(template => template.replace(/^http:/, 'https:'));
  }

  // The tile matrix sets a layer links to, in the order it lists them. Links naming a set
  // the document never defines are skipped.
  protected getLinkedTileMatrixSets(element: Element, tileMatrixSets: Map<string, TileMatrixSet>): TileMatrixSet[] {
    return Array.from(element.getElementsByTagName('TileMatrixSetLink'))
      .map(link => link.getElementsByTagName('TileMatrixSet')[0]?.textContent?.trim())
      .map(id => (id ? tileMatrixSets.get(id) : undefined))
      .filter(set => set !== undefined);
  }

  // Every <TileMatrixSet> definition in the document, keyed by identifier. Each layer also
  // nests a <TileMatrixSet> inside its <TileMatrixSetLink> elements, but those hold only an
  // identifier; the definitions are the ones with <TileMatrix> children.
  protected getTileMatrixSets(metadata: Document): Map<string, TileMatrixSet> {
    const sets = Array.from(metadata.getElementsByTagName('TileMatrixSet'))
      .filter(element => element.getElementsByTagName('TileMatrix').length > 0)
      .map(element => this.parseTileMatrixSet(element))
      .filter(set => set !== undefined);

    return new Map(sets.map(set => [set.id, set]));
  }

  // Read a <TileMatrixSet> definition, working out whether MapLibre can draw from it
  protected parseTileMatrixSet(element: Element): TileMatrixSet | undefined {
    const id = element.getElementsByTagName('ows:Identifier')[0]?.textContent?.trim();
    const crs = element.getElementsByTagName('ows:SupportedCRS')[0]?.textContent?.trim();
    if (!id || !crs) return undefined;

    return { id, crs, grid: this.parseXyzGrid(element, crs) };
  }

  // Reduce a tile matrix set to the numbers MapLibre needs, or undefined if its geometry
  // isn't the XYZ grid. MapLibre draws raster tiles from that one grid only: Web Mercator,
  // hung from the northwest corner of the world, 2^z square tiles on a side at zoom z. Tile
  // indices in any other grid address different ground - a geographic (EPSG:4326) grid, for
  // instance, spaces its rows evenly in latitude and is twice as wide as it is tall - so
  // feeding them to MapLibre draws the wrong place, or falls off the edge of the matrix.
  protected parseXyzGrid(element: Element, crs: string): XyzGrid | undefined {
    if (!isWebMercator(crs)) return undefined;

    const elements = Array.from(element.getElementsByTagName('TileMatrix'));
    const levels = elements.map(matrix => this.parseTileMatrix(matrix)).filter(level => level !== undefined);
    if (levels.length === 0 || levels.length !== elements.length) return undefined;

    // Every level has to agree on tile size and on how it spells its identifier, and each
    // has to hold exactly the tiles that its zoom of the XYZ grid holds
    const [first] = levels;
    if (levels.some(level => level.tileWidth !== first.tileWidth || level.prefix !== first.prefix)) return undefined;
    if (levels.some(level => !isXyzLevel(level))) return undefined;

    const zooms = levels.map(level => level.zoom);
    return {
      tileSize: first.tileWidth,
      levelPrefix: first.prefix,
      minzoom: Math.min(...zooms),
      maxzoom: Math.max(...zooms),
    };
  }

  // Read one <TileMatrix>, or undefined if its identifier doesn't end in a zoom level
  protected parseTileMatrix(element: Element): TileMatrix | undefined {
    const identifier = element.getElementsByTagName('ows:Identifier')[0]?.textContent?.trim() ?? '';
    const level = identifier.match(/^(.*[^0-9])?([0-9]+)$/);
    if (!level) return undefined;

    // MapLibre writes the zoom into {z} in plain decimal, so a level spelled any other way
    // (zero-padded, say) would give us a URL the service doesn't answer to
    if (String(Number(level[2])) !== level[2]) return undefined;

    return {
      zoom: Number(level[2]),
      prefix: level[1] ?? '',
      tileWidth: numericChild(element, 'TileWidth'),
      tileHeight: numericChild(element, 'TileHeight'),
      matrixWidth: numericChild(element, 'MatrixWidth'),
      matrixHeight: numericChild(element, 'MatrixHeight'),
      topLeft: (element.getElementsByTagName('TopLeftCorner')[0]?.textContent ?? '').trim().split(/\s+/).map(Number),
    };
  }

  // Rewrite the tile URL template to a MapLibre-compatible (XYZ-style) URL
  protected formatTileUrl(template: string, style: string, tileMatrixSet: TileMatrixSet, dimensionDefaults?: Record<string, string>): string {
    let url = template
      .replace('{TileMatrixSet}', tileMatrixSet.id)
      .replace('{Style}', style ?? '')
      .replace('{TileMatrix}', `${tileMatrixSet.grid?.levelPrefix ?? ''}{z}`)
      .replace('{TileRow}', '{y}')
      .replace('{TileCol}', '{x}');
    if (dimensionDefaults) {
      for (const [key, value] of Object.entries(dimensionDefaults)) {
        url = url.replace(`{${key}}`, value);
      }
    }
    return url;
  }

  // Explain that we found the layers but can't draw any of them, naming the grids they were
  // published in so the mismatch is visible without reading the GetCapabilities document
  protected unsupportedGridMessage(elements: Element[], tileMatrixSets: Map<string, TileMatrixSet>): string {
    const offered = elements.flatMap(element => this.getLinkedTileMatrixSets(element, tileMatrixSets)).map(set => `${set.id} (${set.crs})`);
    const grids = Array.from(new Set(offered)).join(', ');
    const named = this.options.layerIds.join(', ');

    return `This service publishes ${named} only in tile grids that can't be displayed${grids ? `: ${grids}` : ''}. Previewing WMTS needs a Web Mercator (EPSG:3857) grid, such as GoogleMapsCompatible.`;
  }

  // We rewrite WMTS tile URLs to XYZ-style URLs, so the scheme is always 'xyz'
  getScheme() {
    return 'xyz' as const;
  }
}

// WMTS advertises the CRS in any of several notations - "EPSG:3857",
// "urn:ogc:def:crs:EPSG:6.18:3:3857", "http://www.opengis.net/def/crs/EPSG/0/3857" - all of
// which end in the code.
function isWebMercator(crs: string): boolean {
  const code = crs.split(/[:/]/).pop() ?? '';
  return WEB_MERCATOR_CODES.includes(code);
}

// Whether a level holds exactly what its zoom of the XYZ grid holds: square tiles, 2^z of
// them on a side, hung from the northwest corner of the world
function isXyzLevel(matrix: TileMatrix): boolean {
  const tiles = 2 ** matrix.zoom;
  const [x, y] = matrix.topLeft;

  return (
    matrix.tileWidth === matrix.tileHeight &&
    matrix.matrixWidth === tiles &&
    matrix.matrixHeight === tiles &&
    Math.abs(x + XYZ_ORIGIN) <= ORIGIN_TOLERANCE &&
    Math.abs(y - XYZ_ORIGIN) <= ORIGIN_TOLERANCE
  );
}

// The host a tile template points at, or undefined if it isn't an absolute URL. The braces
// left in the template for MapLibre don't bother the URL parser.
function hostOf(template: string): string | undefined {
  try {
    return new URL(template).host;
  } catch {
    return undefined;
  }
}

// Read a numeric child element, or NaN when it's missing or isn't a number. NaN fails every
// comparison the grid checks make, which is what we want from a malformed definition.
function numericChild(element: Element, tagName: string): number {
  const text = element.getElementsByTagName(tagName)[0]?.textContent?.trim();
  return text ? Number(text) : NaN;
}

// One corner of an OWS bounding box, written as space-separated ordinates
function numericCorner(element: Element, tagName: string): number[] {
  const text = element.getElementsByTagName(tagName)[0]?.textContent?.trim() ?? '';
  return text.split(/\s+/).map(Number);
}

// Where a latitude falls in the Web Mercator world, 0 at the north edge and 1 at the south
function mercatorY(lat: number): number {
  const clamped = clamp(lat, -MERCATOR_MAX_LATITUDE, MERCATOR_MAX_LATITUDE);
  return (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (clamped * Math.PI) / 360))) / 360;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
