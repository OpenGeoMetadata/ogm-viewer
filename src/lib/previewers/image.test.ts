import { describe, it, expect, vi, beforeEach, afterEach } from '@stencil/vitest';
import type { Viewer } from 'openseadragon';

import ImagePreviewer from './image';
import IIIFResource from '../resources/iiif';
import IIIFManifestResource from '../resources/iiif-manifest';

class FakeViewer {
  opened: { tileSource: string }[][] = [];
  closed = 0;

  open(images: { tileSource: string }[]) {
    this.opened.push(images);
  }
  close() {
    this.closed++;
  }
}

const IMAGE_URL = 'https://example.com/iiif/image1/info.json';
const MANIFEST_URL = 'https://example.com/manifest.json';

const manifest = {
  '@context': 'http://iiif.io/api/presentation/3/context.json',
  'id': MANIFEST_URL,
  'type': 'Manifest',
  'items': ['image1', 'image2'].map(name => ({
    id: `https://example.com/canvas/${name}`,
    type: 'Canvas',
    items: [
      {
        id: `https://example.com/annotationpage/${name}`,
        type: 'AnnotationPage',
        items: [
          {
            id: `https://example.com/annotation/${name}`,
            type: 'Annotation',
            body: { id: `https://example.com/${name}/full/full/0/default.jpg`, type: 'Image', service: { id: `https://example.com/${name}`, type: 'ImageService2' } },
          },
        ],
      },
    ],
  })),
};

const serveManifest = (body: unknown) => vi.spyOn(global, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify(body)));

let viewer: FakeViewer;

const previewerFor = (resource: IIIFResource) => new ImagePreviewer(resource).attach(viewer as unknown as Viewer);

describe('ImagePreviewer', () => {
  beforeEach(() => (viewer = new FakeViewer()));
  afterEach(() => vi.restoreAllMocks());

  describe('preview', () => {
    it('opens the image a bare IIIF reference points at', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch');
      await previewerFor(new IIIFResource('princeton-fk4544658v', IMAGE_URL)).preview();

      expect(viewer.opened).toEqual([[{ tileSource: IMAGE_URL }]]);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('opens every image in a manifest, in the order it lists them', async () => {
      serveManifest(manifest);
      await previewerFor(new IIIFManifestResource('princeton-fk4544658v', MANIFEST_URL)).preview();

      expect(viewer.opened).toEqual([[{ tileSource: 'https://example.com/image1/info.json' }, { tileSource: 'https://example.com/image2/info.json' }]]);
    });

    it('reports a manifest it could find no images in rather than opening nothing', async () => {
      serveManifest({ ...manifest, items: [] });

      await expect(previewerFor(new IIIFManifestResource('princeton-fk4544658v', MANIFEST_URL)).preview()).rejects.toThrow('No IIIF images found');
      expect(viewer.opened).toEqual([]);
    });

    it('passes on a manifest that could not be fetched', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce(new Response('Not found', { status: 404, statusText: 'Not Found' }));

      await expect(previewerFor(new IIIFManifestResource('princeton-fk4544658v', MANIFEST_URL)).preview()).rejects.toMatchObject({ name: 'HttpError', status: 404 });
      expect(viewer.opened).toEqual([]);
    });
  });

  describe('clearPreview', () => {
    it('closes what it opened', async () => {
      const previewer = previewerFor(new IIIFResource('princeton-fk4544658v', IMAGE_URL));
      await previewer.preview();
      await previewer.clearPreview();

      expect(viewer.closed).toEqual(1);
    });

    it('does nothing when it was never attached to a viewer', async () => {
      await expect(new ImagePreviewer(new IIIFResource('princeton-fk4544658v', IMAGE_URL)).clearPreview()).resolves.toBeUndefined();
    });
  });

  describe('identity', () => {
    it('labels its tab and names its panel from the resource it draws', () => {
      const image = previewerFor(new IIIFResource('princeton-fk4544658v', IMAGE_URL));
      const manifestPreviewer = previewerFor(new IIIFManifestResource('princeton-fk4544658v', MANIFEST_URL));

      expect(image.label()).toEqual('IIIF Image');
      expect(manifestPreviewer.label()).toEqual('IIIF Manifest');

      expect(image.previewId).toEqual('princeton-fk4544658v-iiif-image-image');
      expect(manifestPreviewer.previewId).toEqual('princeton-fk4544658v-iiif-manifest-image');
    });
  });
});
