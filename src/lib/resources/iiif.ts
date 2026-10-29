import Resource, { type ResourceKind } from './resource';

export default class IIIFResource extends Resource {
  readonly kind: ResourceKind = 'iiif-image';

  label() {
    return 'IIIF Image';
  }

  async getIIIFImageUrls() {
    return [this.url];
  }
}
