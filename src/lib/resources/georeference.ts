import { fetchOrThrow } from '../errors';
import { resolveRequest, type RequestTransform } from '../request';

export type GeoreferenceAnnotation = {
  'id'?: string;
  'type'?: string;
  '@context'?: string | string[];
  'motivation'?: string | string[];
  'body'?: unknown;
  'items'?: unknown[];
};

const GEOREF_CONTEXT = 'iiif.io/api/extension/georef';

// Bound dereferencing depth to prevent cyclic annotation pages from recursing indefinitely.
const MAX_DEPTH = 4;

export function isGeoreferenceAnnotation(node: unknown): node is GeoreferenceAnnotation {
  if (!node || typeof node !== 'object') return false;
  const { motivation, body, '@context': context } = node as GeoreferenceAnnotation;

  if (motivation === 'georeferencing' || (Array.isArray(motivation) && motivation.includes('georeferencing'))) return true;

  const contexts = Array.isArray(context) ? context : [context];
  if (contexts.some(entry => typeof entry === 'string' && entry.includes(GEOREF_CONTEXT))) return true;

  return typeof body === 'object' && body !== null && (body as { type?: string }).type === 'FeatureCollection';
}

export async function findGeoreferenceAnnotation(node: unknown, requestTransform?: RequestTransform, depth = 0): Promise<GeoreferenceAnnotation | undefined> {
  if (depth > MAX_DEPTH || !node || typeof node !== 'object') return undefined;
  if (isGeoreferenceAnnotation(node)) return node as GeoreferenceAnnotation;

  const { type, items } = node as GeoreferenceAnnotation;

  if (type === 'AnnotationPage') {
    const pageItems = items ?? (await dereferencePage(node as GeoreferenceAnnotation, requestTransform));
    if (!pageItems) return undefined;
    if (pageItems.some(isGeoreferenceAnnotation)) return node as GeoreferenceAnnotation;
    return await findFirst(pageItems, requestTransform, depth);
  }

  const { body } = node as GeoreferenceAnnotation;
  if (body) return await findFirst(Array.isArray(body) ? body : [body], requestTransform, depth);

  return undefined;
}

async function findFirst(nodes: unknown[], requestTransform: RequestTransform | undefined, depth: number): Promise<GeoreferenceAnnotation | undefined> {
  for (const child of nodes) {
    const found = await findGeoreferenceAnnotation(child, requestTransform, depth + 1);
    if (found) return found;
  }
  return undefined;
}

async function dereferencePage(page: GeoreferenceAnnotation, requestTransform?: RequestTransform): Promise<unknown[] | undefined> {
  if (!page.id) return undefined;

  try {
    const fetched = await fetchGeoreferenceAnnotation(page.id, requestTransform);
    return fetched.items;
  } catch (error) {
    console.warn(`Could not read the annotation page at ${page.id}:`, error);
    return undefined;
  }
}

export async function fetchGeoreferenceAnnotation(annotationUrl: string, requestTransform?: RequestTransform): Promise<GeoreferenceAnnotation> {
  const { url, init } = resolveRequest(annotationUrl, 'metadata', requestTransform);
  const response = await fetchOrThrow(url, init);
  return await response.json();
}
