import Resource from './resource';

// A source of IIIF image URL(s) to be previewed
export default class IIIFResource extends Resource {
  label() {
    return 'IIIF Image';
  }

  // By default, assume we have a IIIF image URL and just return it
  async getIIIFImageUrls() {
    return [this.url];
  }
}
