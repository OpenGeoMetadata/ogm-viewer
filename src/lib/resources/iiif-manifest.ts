import iiif3 from '@iiif/presentation-3';
import iiif2 from '@iiif/presentation-2';

import type { LngLatBoundsLike } from 'maplibre-gl';

import IIIFResource from './iiif';
import type { ResourceKind } from './resource';
import { fetchOrThrow } from '../errors';
import { resolveRequest, type RequestTransform } from '../request';
import { fetchGeoreferenceAnnotation, findGeoreferenceAnnotation, type GeoreferenceAnnotation } from './georeference';

export default class IIIFManifestResource extends IIIFResource {
  readonly kind: ResourceKind = 'iiif-manifest';

  protected manifest: iiif3.Manifest | iiif2.Manifest | undefined;

  protected georeferenceUrl?: string;

  private georeferenceAnnotation?: Promise<GeoreferenceAnnotation | undefined>;

  constructor(id: string, url: string, bounds?: LngLatBoundsLike, requestTransform?: RequestTransform, georeferenceUrl?: string) {
    super(id, url, bounds, requestTransform);
    this.georeferenceUrl = georeferenceUrl;
  }

  label() {
    return 'IIIF Manifest';
  }

  async isGeoreferenced(): Promise<boolean> {
    return (await this.getGeoreferenceAnnotation()) !== undefined;
  }

  async getGeoreferenceAnnotation(): Promise<GeoreferenceAnnotation | undefined> {
    this.georeferenceAnnotation ??= this.resolveGeoreferenceAnnotation();
    return await this.georeferenceAnnotation;
  }

  private async resolveGeoreferenceAnnotation(): Promise<GeoreferenceAnnotation | undefined> {
    const embedded = await this.findEmbeddedGeoreferenceAnnotation();
    if (embedded) return embedded;

    if (!this.georeferenceUrl) return undefined;

    return await fetchGeoreferenceAnnotation(this.georeferenceUrl, this.requestTransform).catch(error => {
      console.warn(`Could not read the georeference annotation at ${this.georeferenceUrl}:`, error);
      return undefined;
    });
  }

  // Only the first canvas supplies the georeference; paged images remain available in the image preview.
  private async findEmbeddedGeoreferenceAnnotation(): Promise<GeoreferenceAnnotation | undefined> {
    const manifest = await this.fetchManifest().catch(() => undefined);

    if (!manifest || this.getIIIFVersion(manifest) !== 3) return undefined;

    const { annotations, items } = manifest as iiif3.Manifest & { annotations?: unknown[] };
    const firstCanvas = items?.[0] as (iiif3.Canvas & { annotations?: unknown[] }) | undefined;

    for (const page of [...(annotations ?? []), ...(firstCanvas?.annotations ?? [])]) {
      const found = await findGeoreferenceAnnotation(page, this.requestTransform);
      if (found) return found;
    }

    return undefined;
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
