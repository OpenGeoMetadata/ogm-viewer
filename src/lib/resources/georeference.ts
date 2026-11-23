import { fetchOrThrow } from '../errors';
import { resolveRequest, type RequestTransform } from '../request';

export type GeoreferenceAnnotation = {
  'id'?: string;
  'type'?: string;
  '@context'?: string | string[];
  'motivation'?: string | string[];
  'purpose'?: string | string[];
  'body'?: unknown;
  'items'?: unknown[];
};

const GEOREF_CONTEXT = 'iiif.io/api/extension/georef';

// Bound dereferencing depth to prevent cyclic annotation pages from recursing indefinitely.
const MAX_DEPTH = 4;

const includesGeoreferencing = (value: unknown) => value === 'georeferencing' || (Array.isArray(value) && value.includes('georeferencing'));

export function isGeoreferenceAnnotation(node: unknown): node is GeoreferenceAnnotation {
  if (!node || typeof node !== 'object') return false;
  const { type, motivation, body, '@context': context } = node as GeoreferenceAnnotation;

  // A page that declares georeferencing still has to be read for the annotations it holds.
  if (type === 'AnnotationPage') return false;

  if (includesGeoreferencing(motivation)) return true;

  const contexts = Array.isArray(context) ? context : [context];
  if (contexts.some(entry => typeof entry === 'string' && entry.includes(GEOREF_CONTEXT))) return true;

  return typeof body === 'object' && body !== null && (body as { type?: string }).type === 'FeatureCollection';
}

// Allmaps-built manifests label each canvas's referenced page with what it holds, so it can be trusted without fetching it.
export function declaresGeoreferencing(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  const { type, purpose, motivation } = node as GeoreferenceAnnotation;
  return type === 'AnnotationPage' && (includesGeoreferencing(purpose) || includesGeoreferencing(motivation));
}

export async function findGeoreferenceAnnotation(node: unknown, requestTransform?: RequestTransform, depth = 0): Promise<GeoreferenceAnnotation | undefined> {
  return (await search(node, requestTransform, depth, true))[0];
}

// Like findGeoreferenceAnnotation, but keeps looking past the first match so every map in the tree is found.
export async function findGeoreferenceAnnotations(node: unknown, requestTransform?: RequestTransform): Promise<GeoreferenceAnnotation[]> {
  return await search(node, requestTransform, 0, false);
}

async function search(node: unknown, requestTransform: RequestTransform | undefined, depth: number, firstOnly: boolean): Promise<GeoreferenceAnnotation[]> {
  if (depth > MAX_DEPTH || !node || typeof node !== 'object') return [];
  if (isGeoreferenceAnnotation(node)) return [node as GeoreferenceAnnotation];

  const { type, items } = node as GeoreferenceAnnotation;

  if (type === 'AnnotationPage') {
    const pageItems = items ?? (await dereferencePage(node as GeoreferenceAnnotation, requestTransform));
    if (!pageItems) return [];
    // Hand back the page with the items it was dereferenced to; a referenced page carries only its id and type.
    if (pageItems.some(isGeoreferenceAnnotation)) return [{ ...(node as GeoreferenceAnnotation), items: pageItems }];
    return await searchEach(pageItems, requestTransform, depth, firstOnly);
  }

  const { body } = node as GeoreferenceAnnotation;
  if (body) return await searchEach(Array.isArray(body) ? body : [body], requestTransform, depth, firstOnly);

  return [];
}

async function searchEach(nodes: unknown[], requestTransform: RequestTransform | undefined, depth: number, firstOnly: boolean): Promise<GeoreferenceAnnotation[]> {
  const found: GeoreferenceAnnotation[] = [];
  for (const child of nodes) {
    found.push(...(await search(child, requestTransform, depth + 1, firstOnly)));
    if (firstOnly && found.length) break;
  }
  return found;
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
