import iiif3 from '@iiif/presentation-3';
import iiif2 from '@iiif/presentation-2';

import type { LngLatBoundsLike } from 'maplibre-gl';

import IIIFResource from './iiif';
import type { ResourceKind } from './resource';
import { fetchOrThrow } from '../errors';
import { resolveRequest, type RequestTransform } from '../request';
import { fetchGeoreferenceAnnotation, findGeoreferenceAnnotation, type GeoreferenceAnnotation } from './georeference';

// A manifest containing multiple IIIF image URLs for preview
export default class IIIFManifestResource extends IIIFResource {
  readonly kind: ResourceKind = 'iiif-manifest';

  // The parsed manifest contents
  protected manifest: iiif3.Manifest | iiif2.Manifest | undefined;

  // A standalone georeference annotation the record pointed at, if any. Only consulted when the
  // manifest doesn't carry one of its own; see getGeoreferenceAnnotation.
  protected georeferenceUrl?: string;

  // Memoized as the promise rather than its value, so that finding nothing is remembered too and
  // two previewers asking at once share the one walk instead of racing two.
  private georeferenceAnnotation?: Promise<GeoreferenceAnnotation | undefined>;

  constructor(id: string, url: string, bounds?: LngLatBoundsLike, requestTransform?: RequestTransform, georeferenceUrl?: string) {
    super(id, url, bounds, requestTransform);
    this.georeferenceUrl = georeferenceUrl;
  }

  label() {
    return 'IIIF Manifest';
  }

  // Whether this manifest can also be drawn on a map. Costs at least the manifest fetch, and often
  // one more for an annotation page the manifest only links, so the answer is memoized.
  async isGeoreferenced(): Promise<boolean> {
    return (await this.getGeoreferenceAnnotation()) !== undefined;
  }

  // The georeference annotation to warp this scan with, from whichever source has one. The copy in
  // the manifest wins: a record can name a standalone annotation *and* be served a manifest with
  // one spliced in - which is what Stanford's purl does, generating manifests at request time - and
  // in that case the manifest is the more current of the two.
  async getGeoreferenceAnnotation(): Promise<GeoreferenceAnnotation | undefined> {
    this.georeferenceAnnotation ??= this.resolveGeoreferenceAnnotation();
    return await this.georeferenceAnnotation;
  }

  private async resolveGeoreferenceAnnotation(): Promise<GeoreferenceAnnotation | undefined> {
    const embedded = await this.findEmbeddedGeoreferenceAnnotation();
    if (embedded) return embedded;

    if (!this.georeferenceUrl) return undefined;

    // Unlike a manifest we couldn't read, a reference the record made explicitly and we couldn't
    // follow is worth reporting - but not by failing, since the image preview still works
    return await fetchGeoreferenceAnnotation(this.georeferenceUrl, this.requestTransform).catch(error => {
      console.warn(`Could not read the georeference annotation at ${this.georeferenceUrl}:`, error);
      return undefined;
    });
  }

  // Look through the manifest itself. Only the first canvas: a paged object could carry an
  // annotation per page, and one map per page is probably not what anyone wants - see
  // https://github.com/sul-dlss/sul-embed/issues/3124 - so that is left alone deliberately.
  private async findEmbeddedGeoreferenceAnnotation(): Promise<GeoreferenceAnnotation | undefined> {
    const manifest = await this.fetchManifest().catch(() => undefined);

    // A v2 manifest hangs annotations off `otherContent` instead, and no v2 georeferenced manifest
    // has turned up to write that against
    if (!manifest || this.getIIIFVersion(manifest) !== 3) return undefined;

    const { annotations, items } = manifest as iiif3.Manifest & { annotations?: unknown[] };
    const firstCanvas = items?.[0] as (iiif3.Canvas & { annotations?: unknown[] }) | undefined;

    for (const page of [...(annotations ?? []), ...(firstCanvas?.annotations ?? [])]) {
      const found = await findGeoreferenceAnnotation(page, this.requestTransform);
      if (found) return found;
    }

    return undefined;
  }

  // List of IIIF image URLs extracted from the manifest
  async getIIIFImageUrls() {
    // Fetch and cache the manifest if we haven't already
    const manifest: iiif2.Manifest | iiif3.Manifest | undefined = await this.fetchManifest();
    if (!manifest) return [];

    // Try to extract image URLs from the manifest
    if (this.getIIIFVersion(manifest) == 3) return this.extractIiif3ImageUrls(manifest as iiif3.Manifest);
    return this.extractIiif2ImageUrls(manifest as iiif2.Manifest);
  }

  // Attempt to fetch and parse the IIIF manifest, if any
  protected async fetchManifest(): Promise<iiif2.Manifest | iiif3.Manifest | undefined> {
    if (this.manifest) return this.manifest;
    const { url, init } = resolveRequest(this.url, 'metadata', this.requestTransform);
    const response = await fetchOrThrow(url, init);
    const manifest = await response.json();
    this.manifest = manifest;
    return manifest;
  }

  // Get the IIIF presentation spec version of the manifest
  protected getIIIFVersion(manifest: iiif3.Manifest | iiif2.Manifest): 2 | 3 {
    return manifest['@context']?.includes('http://iiif.io/api/presentation/3/context.json') ? 3 : 2;
  }

  // Given a v2 manifest, extract all of the IIIF images and format as info.json URLs
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

  // Given a v3 manifest, extract all of the IIIF images and format as info.json URLs
  protected extractIiif3ImageUrls(manifest: iiif3.Manifest): string[] {
    // Recursively search the '.items' key until we end up with nodes that have type 'ImageService2'
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

  // TODO: use navPlace as the bounds source if available
}
