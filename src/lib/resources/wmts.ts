import { LngLatBounds, type LngLatBoundsLike, type RasterSourceSpecification } from 'maplibre-gl';
import RasterResource from './raster';
import type { ResourceKind } from './resource';
import { fetchOrThrow } from '../errors';
import type { LegendImage } from '../legend';
import { resolveRequest, type RequestTransform } from '../request';
import TimeDomain from '../time';

export type WmtsOptions = {
  layerIds: string[];
  tileSize?: number;
};

export type Bounds = NonNullable<RasterSourceSpecification['bounds']>;

export type WmtsLayer = {
  id: string;
  title: string;
  tileUrls: string[];
  tileSize: number;
  minzoom: number;
  maxzoom: number;
  bounds?: Bounds;
  legendImages?: LegendImage[];
  time?: WmtsTime;
};

export type WmtsDimension = {
  identifier: string;
  default?: string;
  values: string[];
};

export type WmtsTime = {
  identifier: string;
  default: string;
  values: string[];
  templates: string[];
  domainsUrl?: string;
};

type XyzGrid = {
  tileSize: number;
  minzoom: number;
  maxzoom: number;
  levelPrefix: string;
};

type TileMatrixSet = {
  id: string;
  crs: string;
  grid?: XyzGrid;
};

type TileMatrix = {
  zoom: number;
  prefix: string;
  tileWidth: number;
  tileHeight: number;
  matrixWidth: number;
  matrixHeight: number;
  topLeft: number[];
};

const XYZ_ORIGIN = 20037508.342789244;

const ORIGIN_TOLERANCE = 0.5;

const WEB_MERCATOR_CODES = ['3857', '900913', '102100'];

const MERCATOR_MAX_LATITUDE = 85.051129;

const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink';

export default class WmtsResource extends RasterResource {
  readonly kind: ResourceKind = 'wmts';

  private options: WmtsOptions;

  private metadata: Document;

  constructor(id: string, url: string, options: WmtsOptions, bounds?: LngLatBoundsLike, requestTransform?: RequestTransform) {
    super(id, url, bounds, requestTransform);
    this.options = options;

    if (!this.options.layerIds || this.options.layerIds.length === 0) {
      this.options.layerIds = [id];
    }
  }

  label() {
    return 'Web Map Tile Service (WMTS)';
  }

  protected async getMetadata() {
    if (!this.metadata) {
      const { url, init } = resolveRequest(this.url, 'metadata', this.requestTransform);
      const resp = await fetch(url, init);
      const text = await resp.text();
      this.metadata = new DOMParser().parseFromString(text, 'application/xml');
    }
    return this.metadata;
  }

  async getLayers(): Promise<WmtsLayer[]> {
    const metadata = await this.getMetadata();
    const tileMatrixSets = this.getTileMatrixSets(metadata);

    const elements = Array.from(metadata.getElementsByTagName('Layer')).filter(element => this.isRequested(element));
    if (elements.length === 0) throw new Error(`This service doesn't publish a layer named ${this.options.layerIds.join(', ')}.`);

    const layers = elements.map(element => this.createLayer(element, tileMatrixSets)).filter(layer => layer !== undefined);
    if (layers.length === 0) throw new Error(this.unsupportedGridMessage(elements, tileMatrixSets));

    return layers;
  }

  protected isRequested(element: Element): boolean {
    if (this.options.layerIds.length === 0) return true;
    const layerId = element.getElementsByTagName('ows:Identifier')[0]?.textContent?.trim();
    return this.options.layerIds.includes(layerId ?? '');
  }

  protected createLayer(element: Element, tileMatrixSets: Map<string, TileMatrixSet>): WmtsLayer | undefined {
    const layerId = element.getElementsByTagName('ows:Identifier')[0]?.textContent;
    const title = element.getElementsByTagName('ows:Title')[0]?.textContent;

    const styles = Array.from(element.getElementsByTagName('Style'));
    const defaultStyle = styles.find(style => style.getAttribute('isDefault') === 'true');
    const style = defaultStyle ?? styles[0];
    const styleId = style?.getElementsByTagName('ows:Identifier')[0]?.textContent?.trim();

    const tileMatrixSet = this.getLinkedTileMatrixSets(element, tileMatrixSets).find(set => set.grid);
    const grid = tileMatrixSet?.grid;
    if (!tileMatrixSet || !grid) return undefined;

    const templates = this.preferKnownHost(
      Array.from(element.getElementsByTagName('ResourceURL'))
        .filter(resourceUrl => resourceUrl.getAttribute('resourceType') === 'tile')
        .map(resourceUrl => resourceUrl.getAttribute('template') ?? ''),
    );

    const dimensions = this.parseDimensions(element);
    const time = this.timeOf(element, dimensions, templates, styleId, tileMatrixSet);
    const tileUrls = time
      ? time.templates.map(template => template.replaceAll(`{${time.identifier}}`, time.default))
      : templates.map(template => this.formatTileUrl(template, styleId, tileMatrixSet, defaultsOf(dimensions)));

    const bounds = this.parseBounds(element) ?? this.recordBounds();
    const legendImages = this.parseLegendImages(style);

    return {
      id: layerId,
      title: title,
      tileUrls: tileUrls,
      tileSize: this.options.tileSize ?? grid.tileSize,
      minzoom: clamp(this.boundsMinzoom(bounds), grid.minzoom, grid.maxzoom),
      maxzoom: grid.maxzoom,
      bounds: bounds,
      ...(legendImages.length > 0 && { legendImages }),
      ...(time && { time }),
    };
  }

  protected parseDimensions(element: Element): WmtsDimension[] {
    return Array.from(element.getElementsByTagName('Dimension')).flatMap(dimension => {
      const identifier = dimension.getElementsByTagName('ows:Identifier')[0]?.textContent?.trim();
      if (!identifier) return [];

      const defaultValue = dimension.getElementsByTagName('Default')[0]?.textContent?.trim();
      const values = Array.from(dimension.getElementsByTagName('Value'))
        .map(value => value.textContent?.trim() ?? '')
        .filter(value => value !== '');
      return [{ identifier, values, ...(defaultValue && { default: defaultValue }) }];
    });
  }

  protected timeOf(element: Element, dimensions: WmtsDimension[], templates: string[], style: string | undefined, tileMatrixSet: TileMatrixSet): WmtsTime | undefined {
    const dimension = dimensions.find(each => each.identifier.toLowerCase() === 'time');
    if (!dimension) return undefined;

    const timed = templates.filter(template => template.includes(`{${dimension.identifier}}`));
    const domain = TimeDomain.parse(dimension.values);
    if (timed.length === 0 || !domain.offersChoice) return undefined;

    const others = defaultsOf(dimensions.filter(other => other !== dimension));
    const domainsUrl = this.parseDomainsUrl(element, style, tileMatrixSet);

    return {
      identifier: dimension.identifier,
      default: dimension.default ?? domain.format(domain.last!),
      values: dimension.values,
      templates: timed.map(template => this.formatTileUrl(template, style, tileMatrixSet, others)),
      ...(domainsUrl && { domainsUrl }),
    };
  }

  protected parseDomainsUrl(element: Element, style: string | undefined, tileMatrixSet: TileMatrixSet): string | undefined {
    const filled = Array.from(element.getElementsByTagName('ResourceURL'))
      .filter(resourceUrl => resourceUrl.getAttribute('resourceType') === 'Domains')
      .map(resourceUrl =>
        (resourceUrl.getAttribute('template') ?? '')
          .replace('{TileMatrixSet}', tileMatrixSet.id)
          .replace('{Style}', style ?? '')
          .replace('{BBOX}', 'all'),
      )
      .filter(template => template !== '' && !template.includes('{'));

    return this.preferKnownHost(filled)[0];
  }

  async fetchTimeValues(time: WmtsTime): Promise<string[] | undefined> {
    if (!time.domainsUrl) return undefined;

    const { url, init } = resolveRequest(time.domainsUrl, 'metadata', this.requestTransform);
    const response = await fetchOrThrow(url, init);
    const domains = new DOMParser().parseFromString(await response.text(), 'application/xml');

    const described = Array.from(domains.getElementsByTagName('DimensionDomain')).find(
      domain => domain.getElementsByTagName('ows:Identifier')[0]?.textContent?.trim().toLowerCase() === time.identifier.toLowerCase(),
    );
    const values = described?.getElementsByTagName('Domain')[0]?.textContent?.trim();
    return values ? [values] : undefined;
  }

  // OWS WGS84BoundingBox uses longitude/latitude regardless of the tile grid CRS axis order.
  protected parseBounds(element: Element): Bounds | undefined {
    const box = element.getElementsByTagName('ows:WGS84BoundingBox')[0];
    if (!box) return undefined;

    const [west, south] = numericCorner(box, 'ows:LowerCorner');
    const [east, north] = numericCorner(box, 'ows:UpperCorner');
    if ([west, south, east, north].some(value => !Number.isFinite(value))) return undefined;

    return [west, south, east, north];
  }

  protected parseLegendImages(style: Element | undefined): LegendImage[] {
    if (!style) return [];

    return Array.from(style.getElementsByTagName('LegendURL')).flatMap(legend => {
      const href = (legend.getAttributeNS(XLINK_NAMESPACE, 'href') || legend.getAttribute('xlink:href'))?.trim();
      const format = legend.getAttribute('format')?.trim() || undefined;
      if (!href || (format && !format.startsWith('image/'))) return [];

      let url: string;
      try {
        url = new URL(href, this.url).href;
      } catch {
        return [];
      }

      return [
        {
          url,
          format,
          width: positiveAttribute(legend, 'width'),
          height: positiveAttribute(legend, 'height'),
          minScaleDenominator: positiveAttribute(legend, 'minScaleDenominator'),
          maxScaleDenominator: positiveAttribute(legend, 'maxScaleDenominator'),
        },
      ];
    });
  }

  protected recordBounds(): Bounds | undefined {
    if (!this.bounds) return undefined;

    const bounds = LngLatBounds.convert(this.bounds);
    return [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
  }

  // Raise the zoom floor so opaque padding around a small layer does not cover distant areas.
  protected boundsMinzoom(bounds: Bounds | undefined): number {
    if (!bounds) return 0;

    const [west, south, east, north] = bounds;
    const width = east < west ? east - west + 360 : east - west;
    const extent = Math.max(width / 360, mercatorY(south) - mercatorY(north));

    if (!(extent > 0)) return Infinity;

    return Math.ceil(Math.log2(1 / extent));
  }

  // Prefer the known service host because a sharded host may be unreachable from the embedding page.
  protected preferKnownHost(templates: string[]): string[] {
    const capabilities = new URL(this.url);
    const known = templates.filter(template => hostOf(template) === capabilities.host);
    if (known.length === 0) return templates;
    if (capabilities.protocol !== 'https:') return known;

    return known.map(template => template.replace(/^http:/, 'https:'));
  }

  protected getLinkedTileMatrixSets(element: Element, tileMatrixSets: Map<string, TileMatrixSet>): TileMatrixSet[] {
    return Array.from(element.getElementsByTagName('TileMatrixSetLink'))
      .map(link => link.getElementsByTagName('TileMatrixSet')[0]?.textContent?.trim())
      .map(id => (id ? tileMatrixSets.get(id) : undefined))
      .filter(set => set !== undefined);
  }

  protected getTileMatrixSets(metadata: Document): Map<string, TileMatrixSet> {
    const sets = Array.from(metadata.getElementsByTagName('TileMatrixSet'))
      .filter(element => element.getElementsByTagName('TileMatrix').length > 0)
      .map(element => this.parseTileMatrixSet(element))
      .filter(set => set !== undefined);

    return new Map(sets.map(set => [set.id, set]));
  }

  protected parseTileMatrixSet(element: Element): TileMatrixSet | undefined {
    const id = element.getElementsByTagName('ows:Identifier')[0]?.textContent?.trim();
    const crs = element.getElementsByTagName('ows:SupportedCRS')[0]?.textContent?.trim();
    if (!id || !crs) return undefined;

    return { id, crs, grid: this.parseXyzGrid(element, crs) };
  }

  // Only accept the Web Mercator XYZ grid; other tile matrices place indices on different ground.
  protected parseXyzGrid(element: Element, crs: string): XyzGrid | undefined {
    if (!isWebMercator(crs)) return undefined;

    const elements = Array.from(element.getElementsByTagName('TileMatrix'));
    const levels = elements.map(matrix => this.parseTileMatrix(matrix)).filter(level => level !== undefined);
    if (levels.length === 0 || levels.length !== elements.length) return undefined;

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

  protected parseTileMatrix(element: Element): TileMatrix | undefined {
    const identifier = element.getElementsByTagName('ows:Identifier')[0]?.textContent?.trim() ?? '';
    const level = identifier.match(/^(.*[^0-9])?([0-9]+)$/);
    if (!level) return undefined;

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

  protected formatTileUrl(template: string, style: string | undefined, tileMatrixSet: TileMatrixSet, dimensionDefaults?: Record<string, string>): string {
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

  protected unsupportedGridMessage(elements: Element[], tileMatrixSets: Map<string, TileMatrixSet>): string {
    const offered = elements.flatMap(element => this.getLinkedTileMatrixSets(element, tileMatrixSets)).map(set => `${set.id} (${set.crs})`);
    const grids = Array.from(new Set(offered)).join(', ');
    const named = this.options.layerIds.join(', ');

    return `This service publishes ${named} only in tile grids that can't be displayed${grids ? `: ${grids}` : ''}. Previewing WMTS needs a Web Mercator (EPSG:3857) grid, such as GoogleMapsCompatible.`;
  }

  getScheme() {
    return 'xyz' as const;
  }
}

function isWebMercator(crs: string): boolean {
  const code = crs.split(/[:/]/).pop() ?? '';
  return WEB_MERCATOR_CODES.includes(code);
}

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

function defaultsOf(dimensions: WmtsDimension[]): Record<string, string> {
  return Object.fromEntries(dimensions.flatMap(dimension => (dimension.default ? [[dimension.identifier, dimension.default]] : [])));
}

function hostOf(template: string): string | undefined {
  try {
    return new URL(template).host;
  } catch {
    return undefined;
  }
}

function numericChild(element: Element, tagName: string): number {
  const text = element.getElementsByTagName(tagName)[0]?.textContent?.trim();
  return text ? Number(text) : NaN;
}

function positiveAttribute(element: Element, name: string): number | undefined {
  const value = Number(element.getAttribute(name) ?? NaN);
  return value > 0 && Number.isFinite(value) ? value : undefined;
}

function numericCorner(element: Element, tagName: string): number[] {
  const text = element.getElementsByTagName(tagName)[0]?.textContent?.trim() ?? '';
  return text.split(/\s+/).map(Number);
}

function mercatorY(lat: number): number {
  const clamped = clamp(lat, -MERCATOR_MAX_LATITUDE, MERCATOR_MAX_LATITUDE);
  return (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (clamped * Math.PI) / 360))) / 360;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
