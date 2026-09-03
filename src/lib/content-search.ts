import { fetchOrThrow } from './errors';
import { resolveRequest, type RequestTransform } from './request';

export type ContentSearchSelector = {
  type?: string;
  value?: string;
};

export type ContentSearchTarget =
  | string
  | {
      source?: string | { id?: string };
      selector?: ContentSearchSelector | ContentSearchSelector[];
    };

export type ContentSearchBody =
  | string
  | {
      type?: string;
      value?: string;
      format?: string;
      purpose?: string;
      label?: string | Record<string, string[]>;
    };

export type ContentSearchEntityMatch = {
  id?: string;
  type?: string;
  label?: string;
  outcome?: string;
  confidence?: number;
  predicate?: string;
  coordinate_authority?: string;
  query_match?: boolean;
  properties?: Record<string, unknown>;
};

export type ContentSearchEvidence = {
  confidence?: number;
  matched_by?: 'ocr_text' | 'gazetteer_entity' | string;
  entity_matches?: ContentSearchEntityMatch[];
  coordinate_authority?: string;
  [key: string]: unknown;
};

export type ContentSearchAnnotation = {
  'id'?: string;
  'type'?: string;
  'body'?: ContentSearchBody | ContentSearchBody[];
  'target'?: ContentSearchTarget | ContentSearchTarget[];
  'myrdal:evidence'?: ContentSearchEvidence;
  [key: string]: unknown;
};

export type ContentSearchPage = {
  id?: string;
  type?: string;
  items?: ContentSearchAnnotation[];
  startIndex?: number;
  partOf?: { total?: number };
  next?: string | { id?: string };
  prev?: string | { id?: string };
};

export type PixelRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function contentSearchRequestUrl(searchUrl: string, query: string, page = 1): string {
  const url = new URL(searchUrl, globalThis.location?.href ?? 'http://localhost/');
  url.searchParams.set('q', query);
  if (page > 1) url.searchParams.set('page', String(page));
  else url.searchParams.delete('page');
  return url.toString();
}

export async function fetchContentSearch(searchUrl: string, query: string, requestTransform?: RequestTransform, page = 1): Promise<ContentSearchPage> {
  const requestUrl = contentSearchRequestUrl(searchUrl, query, page);
  return fetchContentSearchPage(requestUrl, requestTransform);
}

export async function fetchContentSearchPage(pageUrl: string, requestTransform?: RequestTransform): Promise<ContentSearchPage> {
  const resolvedPageUrl = new URL(pageUrl, globalThis.location?.href ?? 'http://localhost/').toString();
  const { url, init } = resolveRequest(resolvedPageUrl, 'metadata', requestTransform);
  const response = await fetchOrThrow(url, init);
  const data = (await response.json()) as ContentSearchPage;
  if (data.type !== 'AnnotationPage' || !Array.isArray(data.items)) {
    throw new Error('The content search response is not an IIIF AnnotationPage');
  }
  return data;
}

export function annotationText(annotation: ContentSearchAnnotation): string {
  const bodies = Array.isArray(annotation.body) ? annotation.body : [annotation.body];
  for (const body of bodies) {
    if (typeof body === 'string') return body;
    if (body?.value) return body.value;
    if (typeof body?.label === 'string') return body.label;
    if (body?.label && typeof body.label === 'object') {
      const value = Object.values(body.label).flat().find(Boolean);
      if (value) return value;
    }
  }
  return 'Untitled result';
}

export function annotationEvidence(annotation: ContentSearchAnnotation): ContentSearchEvidence | undefined {
  const evidence = annotation['myrdal:evidence'];
  return evidence && typeof evidence === 'object' ? evidence : undefined;
}

export function matchingEntities(annotation: ContentSearchAnnotation): ContentSearchEntityMatch[] {
  const entities = annotationEvidence(annotation)?.entity_matches;
  if (!Array.isArray(entities)) return [];
  return entities.filter(entity => entity && typeof entity === 'object' && Boolean(entity.label));
}

export function pixelRegionFor(annotation: ContentSearchAnnotation): PixelRegion | undefined {
  const targets = Array.isArray(annotation.target) ? annotation.target : [annotation.target];
  for (const target of targets) {
    if (!target || typeof target === 'string') continue;
    const selectors = Array.isArray(target.selector) ? target.selector : [target.selector];
    for (const selector of selectors) {
      const region = pixelRegionForSelector(selector);
      if (region) return region;
    }
  }
  return undefined;
}

function pixelRegionForSelector(selector?: ContentSearchSelector): PixelRegion | undefined {
  if (!selector?.value) return undefined;
  if (selector.type === 'SvgSelector') return svgBounds(selector.value);
  if (selector.type && selector.type !== 'FragmentSelector') return undefined;

  const match = selector.value.match(/(?:^|[&#])xywh=(?:pixel:)?(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)(?:$|[&#])/);
  if (!match) return undefined;
  return positiveRegion(Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4]));
}

function svgBounds(svg: string): PixelRegion | undefined {
  const points = svg.match(/<polygon\b[^>]*\bpoints\s*=\s*["']([^"']+)["']/i)?.[1];
  if (!points) return undefined;
  const coordinates = points
    .trim()
    .split(/\s+/)
    .map(point => point.split(',').map(Number))
    .filter(point => point.length >= 2 && point.every(Number.isFinite));
  if (!coordinates.length) return undefined;
  const xs = coordinates.map(point => point[0]);
  const ys = coordinates.map(point => point[1]);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return positiveRegion(left, top, Math.max(...xs) - left, Math.max(...ys) - top);
}

function positiveRegion(x: number, y: number, width: number, height: number): PixelRegion | undefined {
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return undefined;
  return { x, y, width, height };
}
