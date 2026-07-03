import iiif3 from '@iiif/presentation-3';
import iiif2 from '@iiif/presentation-2';

import IIIFSource from './iiif';

// A manifest containing multiple IIIF image URLs for preview
export default class IIIFManifestSource extends IIIFSource {
  // The parsed manifest contents
  protected manifest: iiif3.Manifest | iiif2.Manifest | undefined;

  label() {
    return 'IIIF Manifest';
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
    const response = await fetch(this.url);
    if (!response.ok) throw new Error(`Unexpected response fetching IIIF manifest: ${response.statusText}`);
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
