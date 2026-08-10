import { fetchOrThrow } from '../errors';
import { resolveRequest, type RequestTransform } from '../request';

// A IIIF Georeference Annotation, or a page of them. Only the parts we test on are described here:
// what turns one into a drawn map is @allmaps/render's business, and it takes the whole document.
// See https://iiif.io/api/extension/georef/
export type GeoreferenceAnnotation = {
  'id'?: string;
  'type'?: string;
  '@context'?: string | string[];
  'motivation'?: string | string[];
  'body'?: unknown;
  'items'?: unknown[];
};

// Both spellings appear in the wild: the extension is published under https, but the annotations
// Allmaps writes name it with http. Matched as a fragment so a version bump doesn't break detection.
const GEOREF_CONTEXT = 'iiif.io/api/extension/georef';

// How far into a manifest's annotations to look. Stanford's purl manifests nest the annotation two
// hops down - an AnnotationPage referenced by the canvas, holding a 'painting' annotation whose body
// is itself the AnnotationPage that Allmaps hosts - and this leaves room for one more wrapper than
// that without letting a cyclic or absurd document turn into an unbounded walk of fetches.
const MAX_DEPTH = 4;

// Whether a node is itself georeference data. Any one of the three is enough: the motivation is what
// the extension specifies, the context is what Allmaps stamps on the annotations it writes, and a
// FeatureCollection body is the shape a renderer actually needs, whatever it was labelled.
export function isGeoreferenceAnnotation(node: unknown): node is GeoreferenceAnnotation {
  if (!node || typeof node !== 'object') return false;
  const { motivation, body, '@context': context } = node as GeoreferenceAnnotation;

  if (motivation === 'georeferencing' || (Array.isArray(motivation) && motivation.includes('georeferencing'))) return true;

  const contexts = Array.isArray(context) ? context : [context];
  if (contexts.some(entry => typeof entry === 'string' && entry.includes(GEOREF_CONTEXT))) return true;

  return typeof body === 'object' && body !== null && (body as { type?: string }).type === 'FeatureCollection';
}

// Find the georeference data inside an arbitrary IIIF annotation tree, dereferencing the pages that
// are given as bare `{id, type}` references along the way. Returns the *containing* AnnotationPage
// when there is one, rather than the single annotation inside it, so a scan georeferenced as several
// maps arrives at the renderer whole.
export async function findGeoreferenceAnnotation(node: unknown, requestTransform?: RequestTransform, depth = 0): Promise<GeoreferenceAnnotation | undefined> {
  if (depth > MAX_DEPTH || !node || typeof node !== 'object') return undefined;
  if (isGeoreferenceAnnotation(node)) return node as GeoreferenceAnnotation;

  const { type, items } = node as GeoreferenceAnnotation;

  if (type === 'AnnotationPage') {
    // A canvas usually only links its annotation pages, so the items are a fetch away
    const pageItems = items ?? (await dereferencePage(node as GeoreferenceAnnotation, requestTransform));
    if (!pageItems) return undefined;
    if (pageItems.some(isGeoreferenceAnnotation)) return node as GeoreferenceAnnotation;
    return await findFirst(pageItems, requestTransform, depth);
  }

  // An annotation that isn't georeference data itself may still be carrying it: Stanford's manifests
  // splice the Allmaps page in as the body of an annotation they motivate as 'painting'.
  const { body } = node as GeoreferenceAnnotation;
  if (body) return await findFirst(Array.isArray(body) ? body : [body], requestTransform, depth);

  return undefined;
}

// The first of these nodes to yield georeference data, searched in order
async function findFirst(nodes: unknown[], requestTransform: RequestTransform | undefined, depth: number): Promise<GeoreferenceAnnotation | undefined> {
  for (const child of nodes) {
    const found = await findGeoreferenceAnnotation(child, requestTransform, depth + 1);
    if (found) return found;
  }
  return undefined;
}

// Read an AnnotationPage the manifest only pointed at. A page we can't read is not an error worth
// failing a preview over - the image itself is still perfectly previewable - so this reports nothing
// and lets the walk end.
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

// Fetch an annotation document, with the resource's own request transform applied. Allmaps offers
// addGeoreferenceAnnotationByUrl, which we deliberately don't use: it fetches with a bare fetch of
// its own, so a restricted annotation would come back 401 with no way to authorize it.
export async function fetchGeoreferenceAnnotation(annotationUrl: string, requestTransform?: RequestTransform): Promise<GeoreferenceAnnotation> {
  const { url, init } = resolveRequest(annotationUrl, 'metadata', requestTransform);
  const response = await fetchOrThrow(url, init);
  return await response.json();
}
