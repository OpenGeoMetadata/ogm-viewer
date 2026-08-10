import { describe, it, expect, vi, afterEach } from '@stencil/vitest';

import IIIFManifestResource from './iiif-manifest';
import type { RequestTransform } from '../request';

const MANIFEST_URL = 'http://example.com/manifest.json';

// A source always points at a manifest URL; the manifest itself is fetched lazily
const createSource = (requestTransform?: RequestTransform) => new IIIFManifestResource('test-id', MANIFEST_URL, undefined, requestTransform);

// A minimal IIIF v2 manifest with a single image
const v2Manifest = {
  '@context': 'http://iiif.io/api/presentation/2/context.json',
  '@id': MANIFEST_URL,
  '@type': 'sc:Manifest',
  'sequences': [
    {
      canvases: [
        {
          images: [
            {
              resource: {
                '@id': 'http://example.com/image1/full/full/0/default.jpg',
                '@type': 'dctypes:Image',
                'service': {
                  '@id': 'http://example.com/image1',
                },
              },
            },
          ],
        },
      ],
    },
  ],
};

// A minimal IIIF v3 manifest with a single image
const v3Manifest = {
  '@context': 'http://iiif.io/api/presentation/3/context.json',
  'id': MANIFEST_URL,
  'type': 'Manifest',
  'items': [
    {
      id: 'http://example.com/canvas1',
      type: 'Canvas',
      items: [
        {
          id: 'http://example.com/annotationpage1',
          type: 'AnnotationPage',
          items: [
            {
              id: 'http://example.com/annotation1',
              type: 'Annotation',
              body: {
                id: 'http://example.com/image1/full/full/0/default.jpg',
                type: 'Image',
                service: {
                  id: 'http://example.com/image1',
                  type: 'ImageService2',
                },
              },
            },
          ],
        },
      ],
    },
  ],
};

describe('IIIFManifestResource', () => {
  afterEach(() => vi.restoreAllMocks());

  describe('getIIIFImageUrls', () => {
    it('should fetch and extract image URLs from a IIIF v2 manifest', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify(v2Manifest)));
      const urls = await createSource().getIIIFImageUrls();
      expect(fetchSpy.mock.calls[0][0]).toBe(MANIFEST_URL);
      expect(urls).toEqual(['http://example.com/image1/info.json']);
    });

    it('should fetch and extract image URLs from a IIIF v3 manifest', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify(v3Manifest)));
      const urls = await createSource().getIIIFImageUrls();
      expect(fetchSpy.mock.calls[0][0]).toBe(MANIFEST_URL);
      expect(urls).toEqual(['http://example.com/image1/info.json']);
    });

    it('should not fetch the manifest again if already cached', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify(v2Manifest)));
      const source = createSource();
      const urls1 = await source.getIIIFImageUrls();
      const urls2 = await source.getIIIFImageUrls();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(urls1).toEqual(['http://example.com/image1/info.json']);
      expect(urls2).toEqual(['http://example.com/image1/info.json']);
    });

    it('should return an empty array if the manifest has no items', async () => {
      const manifest = { ...v3Manifest, items: [] };
      vi.spyOn(global, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify(manifest)));
      const urls = await createSource().getIIIFImageUrls();
      expect(urls).toEqual([]);
    });

    it('should throw if the manifest fetch fails', async () => {
      vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('Network error'));
      await expect(createSource().getIIIFImageUrls()).rejects.toThrow('Network error');
    });

    it('should throw an HttpError if the manifest response is not ok', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce(new Response('Not found', { status: 404, statusText: 'Not Found' }));
      await expect(createSource().getIIIFImageUrls()).rejects.toMatchObject({ name: 'HttpError', status: 404 });
    });

    it('should throw if the manifest is not valid JSON', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce(new Response('invalid json'));
      await expect(createSource().getIIIFImageUrls()).rejects.toThrow();
    });

    it('should throw if the manifest does not match the IIIF spec', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ unexpected: 'structure' })));
      await expect(createSource().getIIIFImageUrls()).rejects.toThrow();
    });

    it('applies a requestTransform to the manifest fetch', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify(v2Manifest)));
      const transform: RequestTransform = () => ({ headers: { Authorization: 'Bearer token' }, credentials: 'include' });

      await createSource(transform).getIIIFImageUrls();

      expect(fetchSpy.mock.calls[0]).toEqual([MANIFEST_URL, { headers: { Authorization: 'Bearer token' }, credentials: 'include' }]);
    });
  });

  describe('getGeoreferenceAnnotation', () => {
    const ANNOTATION_URL = 'http://example.com/annotation.json';

    const annotationFor = (id: string) => ({
      id,
      type: 'AnnotationPage',
      items: [{ type: 'Annotation', motivation: 'georeferencing', body: { type: 'FeatureCollection', features: [] } }],
    });

    // A canvas carrying its annotation page whole, so nothing needs dereferencing
    const georeferencedManifest = (annotationId: string) => ({
      ...v3Manifest,
      items: [{ ...v3Manifest.items[0], annotations: [annotationFor(annotationId)] }],
    });

    const sourceWith = (georeferenceUrl?: string, requestTransform?: RequestTransform) =>
      new IIIFManifestResource('test-id', MANIFEST_URL, undefined, requestTransform, georeferenceUrl);

    it('finds nothing in a manifest that carries no annotations', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(v3Manifest)));

      expect(await sourceWith().getGeoreferenceAnnotation()).toBeUndefined();
      expect(await sourceWith().isGeoreferenced()).toBe(false);
    });

    it('finds an annotation the manifest carries', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(georeferencedManifest('embedded'))));
      const source = sourceWith();

      expect(await source.getGeoreferenceAnnotation()).toEqual(annotationFor('embedded'));
      expect(await source.isGeoreferenced()).toBe(true);
    });

    it('falls back to a standalone annotation when the manifest carries none', async () => {
      vi.spyOn(global, 'fetch').mockImplementation(async url =>
        url === MANIFEST_URL ? new Response(JSON.stringify(v3Manifest)) : new Response(JSON.stringify(annotationFor('standalone'))),
      );

      expect(await sourceWith(ANNOTATION_URL).getGeoreferenceAnnotation()).toEqual(annotationFor('standalone'));
    });

    // The rule when a record names an annotation *and* is served a manifest with one spliced in,
    // which is what Stanford's purl does, generating manifests at request time
    it("prefers the manifest's own annotation over a standalone one", async () => {
      const fetchSpy = vi
        .spyOn(global, 'fetch')
        .mockImplementation(async url =>
          url === MANIFEST_URL ? new Response(JSON.stringify(georeferencedManifest('embedded'))) : new Response(JSON.stringify(annotationFor('standalone'))),
        );

      expect(await sourceWith(ANNOTATION_URL).getGeoreferenceAnnotation()).toEqual(annotationFor('embedded'));
      // And doesn't pay for the reference it didn't need
      expect(fetchSpy).not.toHaveBeenCalledWith(ANNOTATION_URL, expect.anything());
    });

    it('finds an annotation hung off the manifest itself rather than a canvas', async () => {
      const manifest = { ...v3Manifest, annotations: [annotationFor('manifest-level')] };
      vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(manifest)));

      expect(await sourceWith().getGeoreferenceAnnotation()).toEqual(annotationFor('manifest-level'));
    });

    // Only the first canvas is inspected: a paged object could carry one per page, and a map tab per
    // page is probably not what anyone wants. See https://github.com/sul-dlss/sul-embed/issues/3124
    it('ignores an annotation on a canvas other than the first', async () => {
      const manifest = {
        ...v3Manifest,
        items: [v3Manifest.items[0], { ...v3Manifest.items[0], id: 'http://example.com/canvas2', annotations: [annotationFor('second-canvas')] }],
      };
      vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(manifest)));

      expect(await sourceWith().getGeoreferenceAnnotation()).toBeUndefined();
    });

    // A v2 manifest hangs annotations off otherContent instead, which nothing here reads yet
    it('does not look for annotations in a v2 manifest', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(v2Manifest)));

      expect(await sourceWith().getGeoreferenceAnnotation()).toBeUndefined();
    });

    it('applies a requestTransform to the standalone annotation fetch', async () => {
      const fetchSpy = vi
        .spyOn(global, 'fetch')
        .mockImplementation(async url => (url === MANIFEST_URL ? new Response(JSON.stringify(v3Manifest)) : new Response(JSON.stringify(annotationFor('standalone')))));
      const transform: RequestTransform = () => ({ headers: { Authorization: 'Bearer token' } });

      await sourceWith(ANNOTATION_URL, transform).getGeoreferenceAnnotation();

      expect(fetchSpy).toHaveBeenCalledWith(ANNOTATION_URL, { headers: { Authorization: 'Bearer token' } });
    });

    // The image preview still works, so neither an unreadable manifest nor an unreadable annotation
    // is worth failing over - they just mean there's no map to offer
    it('reports no annotation when the manifest cannot be read', async () => {
      vi.spyOn(global, 'fetch').mockRejectedValue(new TypeError('offline'));

      expect(await sourceWith().isGeoreferenced()).toBe(false);
    });

    it('reports no annotation when the standalone reference cannot be followed', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(global, 'fetch').mockImplementation(async url => {
        if (url === MANIFEST_URL) return new Response(JSON.stringify(v3Manifest));
        throw new TypeError('offline');
      });

      expect(await sourceWith(ANNOTATION_URL).isGeoreferenced()).toBe(false);
      expect(warn).toHaveBeenCalled();
    });

    // Both previewers of one manifest ask, and the walk costs at least one fetch and often two
    it('resolves the annotation once however many times it is asked', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(georeferencedManifest('embedded'))));
      const source = sourceWith();

      await Promise.all([source.getGeoreferenceAnnotation(), source.getGeoreferenceAnnotation()]);
      await source.isGeoreferenced();

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });
});
