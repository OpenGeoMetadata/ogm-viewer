import Resource, { type ResourceKind } from './resource';

// A source of IIIF image URL(s) to be previewed
export default class IIIFResource extends Resource {
  readonly kind: ResourceKind = 'iiif-image';

  label() {
    return 'IIIF Image';
  }

  // By default, assume we have a IIIF image URL and just return it
  async getIIIFImageUrls() {
    return [this.url];
  }
}
