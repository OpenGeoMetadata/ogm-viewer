import type { Viewer } from 'openseadragon';

import Previewer from './previewer';
import type IIIFResource from '../resources/iiif';

export default class ImagePreviewer extends Previewer {
  readonly renderer = 'image' as const;

  declare protected resource: IIIFResource;

  protected viewer: Viewer;

  attach(viewer: Viewer): this {
    this.viewer = viewer;
    return this;
  }

  async preview(): Promise<void> {
    const images = await this.resource.getIIIFImageUrls();
    if (!images.length) throw new Error('No IIIF images found for this preview');
    this.viewer.open(images.map(tileSource => ({ tileSource })));
  }

  async clearPreview(): Promise<void> {
    if (!this.viewer) return;
    this.viewer.close();
  }
}
