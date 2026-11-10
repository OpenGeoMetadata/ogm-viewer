import { describe, it, expect, vi, afterEach } from '@stencil/vitest';

import IIIFManifestResource from './iiif-manifest';
import type { RequestTransform } from '../request';

const MANIFEST_URL = 'http://example.com/manifest.json';

const createSource = (requestTransform?: RequestTransform) => new IIIFManifestResource('test-id', MANIFEST_URL, undefined, requestTransform);

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
                service: [
                  {
                    id: 'http://example.com/image1',
                    type: 'ImageService2',
                  },
                ],
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

    it('finds an annotation in a page the manifest references by id', async () => {
      const PAGE_URL = 'http://example.com/annotations/referenced';
      const manifest = { ...v3Manifest, items: [{ ...v3Manifest.items[0], annotations: [{ id: PAGE_URL, type: 'AnnotationPage' }] }] };
      vi.spyOn(global, 'fetch').mockImplementation(async url =>
        url === MANIFEST_URL ? new Response(JSON.stringify(manifest)) : new Response(JSON.stringify(annotationFor(PAGE_URL))),
      );

      expect(await sourceWith().getGeoreferenceAnnotation()).toEqual(annotationFor(PAGE_URL));
    });

    it('falls back to a standalone annotation when the manifest carries none', async () => {
      vi.spyOn(global, 'fetch').mockImplementation(async url =>
        url === MANIFEST_URL ? new Response(JSON.stringify(v3Manifest)) : new Response(JSON.stringify(annotationFor('standalone'))),
      );

      expect(await sourceWith(ANNOTATION_URL).getGeoreferenceAnnotation()).toEqual(annotationFor('standalone'));
    });

    it("prefers the manifest's own annotation over a standalone one", async () => {
      const fetchSpy = vi
        .spyOn(global, 'fetch')
        .mockImplementation(async url =>
          url === MANIFEST_URL ? new Response(JSON.stringify(georeferencedManifest('embedded'))) : new Response(JSON.stringify(annotationFor('standalone'))),
        );

      expect(await sourceWith(ANNOTATION_URL).getGeoreferenceAnnotation()).toEqual(annotationFor('embedded'));
      expect(fetchSpy).not.toHaveBeenCalledWith(ANNOTATION_URL, expect.anything());
    });

    it('finds an annotation hung off the manifest itself rather than a canvas', async () => {
      const manifest = { ...v3Manifest, annotations: [annotationFor('manifest-level')] };
      vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(manifest)));

      expect(await sourceWith().getGeoreferenceAnnotation()).toEqual(annotationFor('manifest-level'));
    });

    it('ignores an annotation on a canvas other than the first', async () => {
      const manifest = {
        ...v3Manifest,
        items: [v3Manifest.items[0], { ...v3Manifest.items[0], id: 'http://example.com/canvas2', annotations: [annotationFor('second-canvas')] }],
      };
      vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(manifest)));

      expect(await sourceWith().getGeoreferenceAnnotation()).toBeUndefined();
    });

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

    it('resolves the annotation once however many times it is asked', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(georeferencedManifest('embedded'))));
      const source = sourceWith();

      await Promise.all([source.getGeoreferenceAnnotation(), source.getGeoreferenceAnnotation()]);
      await source.isGeoreferenced();

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    describe('when the annotation targets a canvas', () => {
      const CANVAS_ID = 'http://example.com/canvas1';
      const selector = { type: 'SvgSelector', value: '<svg width="2000" height="1000"><polygon points="0,0 2000,0 2000,1000" /></svg>' };

      const targeting = (source: object) => ({
        type: 'Annotation',
        motivation: 'georeferencing',
        target: { type: 'SpecificResource', source, selector },
        body: { type: 'FeatureCollection', features: [] },
      });

      const pageOf = (...items: object[]) => ({ id: 'http://example.com/georeference', type: 'AnnotationPage', items });

      const manifestWith = (canvas: object, annotations: object[] = []) => ({
        ...v3Manifest,
        items: [{ ...v3Manifest.items[0], width: 2000, height: 1000, annotations, ...canvas }],
      });

      const resolvedSource = {
        id: 'http://example.com/image1',
        type: 'ImageService2',
        width: 2000,
        height: 1000,
        partOf: [{ id: CANVAS_ID, type: 'Canvas', partOf: [{ id: MANIFEST_URL, type: 'Manifest' }] }],
      };

      it('points an embedded annotation at the image service painted on that canvas', async () => {
        const manifest = manifestWith({}, [pageOf(targeting({ id: CANVAS_ID, type: 'Canvas' }))]);
        vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(manifest)));

        expect(await sourceWith().getGeoreferenceAnnotation()).toMatchObject({ type: 'AnnotationPage', items: [{ target: { source: resolvedSource } }] });
      });

      it('points a standalone annotation at the image service using the manifest', async () => {
        const fetchSpy = vi
          .spyOn(global, 'fetch')
          .mockImplementation(async url =>
            url === MANIFEST_URL ? new Response(JSON.stringify(manifestWith({}))) : new Response(JSON.stringify(targeting({ id: CANVAS_ID, type: 'Canvas' }))),
          );

        expect(await sourceWith(ANNOTATION_URL).getGeoreferenceAnnotation()).toMatchObject({ type: 'Annotation', target: { source: resolvedSource } });
        expect(fetchSpy).toHaveBeenCalledTimes(2);
      });

      it('sizes the image service as its service says rather than as the canvas', async () => {
        const canvas = v3Manifest.items[0];
        const page = canvas.items[0];
        const body = { ...page.items[0].body, service: [{ ...page.items[0].body.service[0], width: 4000, height: 2000 }] };
        const manifest = manifestWith({ items: [{ ...page, items: [{ ...page.items[0], body }] }] }, [pageOf(targeting({ id: CANVAS_ID, type: 'Canvas' }))]);
        vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(manifest)));

        const annotation = await sourceWith().getGeoreferenceAnnotation();

        expect(annotation?.items?.[0]).toMatchObject({ target: { source: { id: 'http://example.com/image1', type: 'ImageService2', width: 4000, height: 2000 } } });
      });

      it('leaves an annotation targeting an image service alone', async () => {
        const page = pageOf(targeting({ id: 'http://example.com/image1', type: 'ImageService2', width: 2000, height: 1000 }));
        vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(manifestWith({}, [page]))));

        expect(await sourceWith().getGeoreferenceAnnotation()).toEqual(page);
      });

      it('leaves an annotation targeting a canvas the manifest does not have alone', async () => {
        const page = pageOf(targeting({ id: 'http://example.com/elsewhere', type: 'Canvas' }));
        vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(manifestWith({}, [page]))));

        expect(await sourceWith().getGeoreferenceAnnotation()).toEqual(page);
      });

      it('points an annotation at the image service painted on a canvas in a v2 manifest', async () => {
        const image = v2Manifest.sequences[0].canvases[0].images[0];
        const service = { '@id': 'http://example.com/image1', 'profile': 'http://iiif.io/api/image/2/level2.json' };
        const canvas = { '@id': CANVAS_ID, '@type': 'sc:Canvas', 'width': 2000, 'height': 1000, 'images': [{ ...image, resource: { ...image.resource, service } }] };
        const manifest = { ...v2Manifest, sequences: [{ canvases: [canvas] }] };
        vi.spyOn(global, 'fetch').mockImplementation(async url =>
          url === MANIFEST_URL ? new Response(JSON.stringify(manifest)) : new Response(JSON.stringify(targeting({ id: CANVAS_ID, type: 'Canvas' }))),
        );

        expect(await sourceWith(ANNOTATION_URL).getGeoreferenceAnnotation()).toMatchObject({ target: { source: resolvedSource } });
      });

      it('leaves an annotation alone and warns when Allmaps cannot read the manifest', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const page = pageOf(targeting({ id: CANVAS_ID, type: 'Canvas' }));
        const manifest = manifestWith({ width: undefined }, [page]);
        vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(manifest)));

        expect(await sourceWith().getGeoreferenceAnnotation()).toEqual(page);
        expect(warn).toHaveBeenCalledOnce();
      });

      it('leaves an annotation Allmaps cannot parse for the layer to report', async () => {
        const page = pageOf({ ...targeting({ id: CANVAS_ID, type: 'Canvas' }), target: { type: 'SpecificResource', source: { id: CANVAS_ID, type: 'Canvas' } } });
        vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(manifestWith({}, [page]))));

        expect(await sourceWith().getGeoreferenceAnnotation()).toEqual(page);
      });
    });
  });
});
