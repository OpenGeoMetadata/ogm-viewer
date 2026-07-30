import type { Viewer } from 'openseadragon';

import Previewer from './previewer';
import type IIIFResource from '../resources/iiif';

// A preview drawn by an image viewer rather than a map. The shape mirrors MapPreviewer: ogm-image
// builds the viewer and hands it over, and this is what knows how to put a resource into it and
// take it back out. One class rather than a hierarchy, because the difference between a bare image
// URL and a manifest that has to be fetched and walked already lives in the resource.
export default class ImagePreviewer extends Previewer {
  readonly renderer = 'image' as const;

  declare protected resource: IIIFResource;

  // Set by attach(), before anything is drawn. Not a constructor argument, for the same reason a
  // map isn't: OpenSeadragon needs an element to mount into, so the viewer doesn't exist until
  // ogm-image has rendered - long after a record's previews have been worked out.
  protected viewer: Viewer;

  attach(viewer: Viewer): this {
    this.viewer = viewer;
    return this;
  }

  // Open this resource's images, in order. A manifest is fetched and walked here, so this is the
  // first thing that can fail for a IIIF preview.
  async preview(): Promise<void> {
    const images = await this.resource.getIIIFImageUrls();
    if (!images.length) throw new Error('No IIIF images found for this preview');
    this.viewer.open(images);
  }

  // OpenSeadragon owns its own canvas, so unlike a map there is no shared document to take this
  // preview back out of - closing is the whole of it.
  async clearPreview(): Promise<void> {
    if (!this.viewer) return;
    this.viewer.close();
  }
}
