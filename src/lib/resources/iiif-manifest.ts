import iiif3 from '@iiif/presentation-3';
import iiif2 from '@iiif/presentation-2';
import { generateAnnotation, parseAnnotation, type GeoreferencedMap, type PartOfItem } from '@allmaps/annotation';
import { Manifest } from '@allmaps/iiif-parser';

import type { LngLatBoundsLike } from 'maplibre-gl';

import IIIFResource from './iiif';
import type { ResourceKind } from './resource';
import { fetchOrThrow } from '../errors';
import { resolveRequest, type RequestTransform } from '../request';
import { declaresGeoreferencing, fetchGeoreferenceAnnotation, findGeoreferenceAnnotations, isGeoreferenceAnnotation, type GeoreferenceAnnotation } from './georeference';

type AnnotatedCanvas = iiif3.Canvas & { annotations?: unknown[] };

export default class IIIFManifestResource extends IIIFResource {
  readonly kind: ResourceKind = 'iiif-manifest';

  protected manifest: iiif3.Manifest | iiif2.Manifest | undefined;

  protected georeferenceUrl?: string;

  private annotationsByPage?: Promise<Promise<GeoreferenceAnnotation[]>[]>;

  constructor(id: string, url: string, bounds?: LngLatBoundsLike, requestTransform?: RequestTransform, georeferenceUrl?: string) {
    super(id, url, bounds, requestTransform);
    this.georeferenceUrl = georeferenceUrl;
  }

  label() {
    return 'IIIF Manifest';
  }

  async isGeoreferenced(): Promise<boolean> {
    if ((await this.georeferencePages()).some(holdsGeoreferencing)) return true;
    return (await this.getGeoreferenceAnnotation()) !== undefined;
  }

  async getGeoreferenceAnnotation(): Promise<GeoreferenceAnnotation | undefined> {
    const annotations = await Promise.all(await this.readAnnotationsByPage());
    return mergeAnnotations(annotations.flat());
  }

  // Each annotation in canvas order, resolving one-by-one. Idempotent.
  async *georeferenceAnnotations(): AsyncGenerator<GeoreferenceAnnotation> {
    for (const page of await this.readAnnotationsByPage()) yield* await page;
  }

  private async readAnnotationsByPage(): Promise<Promise<GeoreferenceAnnotation[]>[]> {
    this.annotationsByPage ??= this.findAnnotationsByPage();
    return await this.annotationsByPage;
  }

  // One promise per annotation page plus one for a standalone annotation
  private async findAnnotationsByPage(): Promise<Promise<GeoreferenceAnnotation[]>[]> {
    const seen = new Set<string>();
    let previous: Promise<unknown> = Promise.resolve();

    // Waiting on the previous page keeps canvas order, so a map linked from several canvases goes to the first.
    const inOrder = (found: Promise<GeoreferenceAnnotation[]>) => {
      const added = Promise.all([found, previous])
        .then(([annotations]) => annotations.flatMap(annotation => withoutRepeats(annotation, seen) ?? []).map(fresh => this.resolveCanvasSources(fresh)))
        .catch(error => {
          console.warn(`Could not read some of the georeferencing in ${this.url}:`, error);
          return [];
        });
      previous = added;
      return added;
    };

    const pages = (await this.georeferencePages()).map(page => inOrder(findGeoreferenceAnnotations(page, this.requestTransform)));
    const standalone = Promise.all(pages).then(async found => {
      if (found.some(annotations => annotations.length)) return [];
      const annotation = await this.fetchStandaloneGeoreferenceAnnotation();
      return annotation ? [annotation] : [];
    });

    return [...pages, inOrder(standalone)];
  }

  private async fetchStandaloneGeoreferenceAnnotation(): Promise<GeoreferenceAnnotation | undefined> {
    if (!this.georeferenceUrl) return undefined;

    return await fetchGeoreferenceAnnotation(this.georeferenceUrl, this.requestTransform).catch(error => {
      console.warn(`Could not read the georeference annotation at ${this.georeferenceUrl}:`, error);
      return undefined;
    });
  }

  // Valid IIIF georeference annotations target a canvas, but Allmaps needs to
  // resolve them to image services to draw, so we retarget them like Allmaps
  private resolveCanvasSources(annotation: GeoreferenceAnnotation): GeoreferenceAnnotation {
    const maps = parseMaps(annotation);
    if (!maps?.some(map => map.resource.type === 'Canvas')) return annotation;

    const manifest = this.parseManifest();
    if (!manifest) return annotation;

    const resolved = maps.map(map => resolveCanvasResource(map, manifest));
    if (resolved.every((map, index) => map === maps[index])) return annotation;

    return generateAnnotation(annotation.type === 'AnnotationPage' ? resolved : resolved[0]) as GeoreferenceAnnotation;
  }

  private parseManifest(): Manifest | undefined {
    try {
      return Manifest.parse(this.manifest);
    } catch (error) {
      console.warn(`Could not find the canvases in ${this.url}, so maps on them may not draw:`, error);
      return undefined;
    }
  }

  // Annotation pages that may hold georeferencing: every page on the manifest and its first canvas, but on later
  // canvases only embedded pages or ones that declare it, so a long book's other pages aren't all fetched.
  private async georeferencePages(): Promise<unknown[]> {
    const manifest = await this.fetchManifest().catch(() => undefined);
    if (!manifest || this.getIIIFVersion(manifest) !== 3) return [];

    const { annotations = [], items = [] } = manifest as iiif3.Manifest & { annotations?: unknown[] };
    const [firstCanvas, ...laterCanvases] = items as AnnotatedCanvas[];
    const laterPages = laterCanvases.flatMap(canvas => canvas.annotations ?? []).filter(page => isEmbedded(page) || declaresGeoreferencing(page));

    return uniqueById([...annotations, ...(firstCanvas?.annotations ?? []), ...laterPages]);
  }

  async getIIIFImageUrls() {
    const manifest: iiif2.Manifest | iiif3.Manifest | undefined = await this.fetchManifest();
    if (!manifest) return [];

    if (this.getIIIFVersion(manifest) == 3) return this.extractIiif3ImageUrls(manifest as iiif3.Manifest);
    return this.extractIiif2ImageUrls(manifest as iiif2.Manifest);
  }

  protected async fetchManifest(): Promise<iiif2.Manifest | iiif3.Manifest | undefined> {
    if (this.manifest) return this.manifest;
    const { url, init } = resolveRequest(this.url, 'metadata', this.requestTransform);
    const response = await fetchOrThrow(url, init);
    const manifest = await response.json();
    this.manifest = manifest;
    return manifest;
  }

  protected getIIIFVersion(manifest: iiif3.Manifest | iiif2.Manifest): 2 | 3 {
    return manifest['@context']?.includes('http://iiif.io/api/presentation/3/context.json') ? 3 : 2;
  }

  protected extractIiif2ImageUrls(manifest: iiif2.Manifest): string[] {
    return (
      manifest.sequences
        .flatMap(seq => seq.canvases)
        .flatMap(can => can.images)
        .flatMap(img => img.resource)
        //@ts-ignore
        .flatMap(res => (res['@type'] === 'dctypes:Image' ? res.service['@id'] + '/info.json' : []))
    );
  }

  protected extractIiif3ImageUrls(manifest: iiif3.Manifest): string[] {
    return (
      manifest.items
        .flatMap(canvas => canvas.items)
        .flatMap(annotationPage => annotationPage?.items || [])
        .flatMap(annotation => (Array.isArray(annotation.body) ? annotation.body : [annotation.body]))
        //@ts-ignore
        .flatMap(annotationBody => annotationBody.service)
        .flatMap(service => service.id + '/info.json')
    );
  }
}

const isEmbedded = (page: unknown) => Array.isArray((page as GeoreferenceAnnotation | undefined)?.items);

const holdsGeoreferencing = (page: unknown) => declaresGeoreferencing(page) || (isEmbedded(page) && (page as GeoreferenceAnnotation).items!.some(isGeoreferenceAnnotation));

function uniqueById<T>(nodes: T[]): T[] {
  const seen = new Set<string>();
  return nodes.filter(node => {
    const id = (node as { id?: unknown } | undefined)?.id;
    if (typeof id !== 'string') return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

const georeferenceAnnotationsIn = (found: GeoreferenceAnnotation): GeoreferenceAnnotation[] =>
  found.type === 'AnnotationPage' ? ((found.items ?? []).filter(isGeoreferenceAnnotation) as GeoreferenceAnnotation[]) : [found];

// Deduplicate annotations shared across multiple canvases
function withoutRepeats(found: GeoreferenceAnnotation, seen: Set<string>): GeoreferenceAnnotation | undefined {
  const annotations = georeferenceAnnotationsIn(found);
  const fresh = annotations.filter(annotation => typeof annotation.id !== 'string' || !seen.has(annotation.id));
  fresh.forEach(annotation => typeof annotation.id === 'string' && seen.add(annotation.id));

  if (!fresh.length) return undefined;
  return fresh.length === annotations.length ? found : { ...found, items: fresh };
}

// Merge annotations into a single page
function mergeAnnotations(annotations: GeoreferenceAnnotation[]): GeoreferenceAnnotation | undefined {
  if (annotations.length <= 1) return annotations[0];
  return { '@context': 'http://www.w3.org/ns/anno.jsonld', 'type': 'AnnotationPage', 'items': annotations.flatMap(georeferenceAnnotationsIn) };
}

function parseMaps(annotation: GeoreferenceAnnotation): GeoreferencedMap[] | undefined {
  try {
    return parseAnnotation(annotation);
  } catch {
    return undefined;
  }
}

// Leaves the map alone unless its resource is a canvas in this manifest.
function resolveCanvasResource(map: GeoreferencedMap, manifest: Manifest): GeoreferencedMap {
  const { resource } = map;
  if (resource.type !== 'Canvas') return map;

  const canvas = manifest.canvases.find(candidate => candidate.uri === resource.id);
  if (!canvas) return map;

  const { image } = canvas;
  const partOf: PartOfItem[] = [{ id: canvas.uri, type: 'Canvas', label: canvas.label, partOf: [{ id: manifest.uri, type: 'Manifest', label: manifest.label }] }];

  return { ...map, resource: { ...resource, id: image.uri, type: `ImageService${image.majorVersion}`, width: image.width, height: image.height, partOf } };
}
