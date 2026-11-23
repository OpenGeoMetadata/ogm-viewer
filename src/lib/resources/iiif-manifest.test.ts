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

    describe('across the canvases of a paged manifest', () => {
      const georeference = (id: string) => ({ id, type: 'Annotation', motivation: 'georeferencing', body: { type: 'FeatureCollection', features: [] } });
      const painting = { id: 'http://example.com/painting', type: 'Annotation', motivation: 'painting', body: { type: 'Image' } };

      const canvasWith = (index: number, annotations: object[]) => ({ ...v3Manifest.items[0], id: `http://example.com/canvas${index}`, annotations });

      // The first canvas is a title page with nothing on it, as in an atlas or a map series.
      const manifestOf = (...annotationsPerCanvas: object[][]) => ({
        ...v3Manifest,
        items: [v3Manifest.items[0], ...annotationsPerCanvas.map((annotations, index) => canvasWith(index + 2, annotations))],
      });

      const declared = (id: string) => ({ id, type: 'AnnotationPage', label: { en: ['Georeference Annotation'] }, purpose: 'georeferencing' });

      const serving = (manifest: object, pages: Record<string, object> = {}) =>
        vi.spyOn(global, 'fetch').mockImplementation(async url => {
          if (url === MANIFEST_URL) return new Response(JSON.stringify(manifest));
          const page = pages[url as string];
          return page ? new Response(JSON.stringify(page)) : new Response('Not found', { status: 404 });
        });

      it('finds an annotation on a canvas other than the first', async () => {
        serving(manifestOf([annotationFor('second-canvas')]));

        expect(await sourceWith().getGeoreferenceAnnotation()).toEqual(annotationFor('second-canvas'));
      });

      it('draws the maps of every canvas together as one page', async () => {
        const one = { type: 'AnnotationPage', items: [georeference('http://example.com/maps/one')] };
        const two = { type: 'AnnotationPage', items: [georeference('http://example.com/maps/two')] };
        serving(manifestOf([one], [two]));

        expect(await sourceWith().getGeoreferenceAnnotation()).toEqual({
          '@context': 'http://www.w3.org/ns/anno.jsonld',
          'type': 'AnnotationPage',
          'items': [georeference('http://example.com/maps/one'), georeference('http://example.com/maps/two')],
        });
      });

      it('leaves out what is not georeferencing when it puts the pages together', async () => {
        const one = { type: 'AnnotationPage', items: [painting, georeference('http://example.com/maps/one')] };
        const two = { type: 'AnnotationPage', items: [georeference('http://example.com/maps/two')] };
        serving(manifestOf([one], [two]));

        const annotation = await sourceWith().getGeoreferenceAnnotation();

        expect(annotation?.items?.map(item => (item as { id: string }).id)).toEqual(['http://example.com/maps/one', 'http://example.com/maps/two']);
      });

      it('follows the page a later canvas links when the page says it holds georeferencing', async () => {
        const PAGE_URL = 'https://annotations.allmaps.org/images/one';
        serving(manifestOf([declared(PAGE_URL)]), { [PAGE_URL]: { id: PAGE_URL, type: 'AnnotationPage', items: [georeference('http://example.com/maps/one')] } });

        expect(await sourceWith().getGeoreferenceAnnotation()).toMatchObject({ id: PAGE_URL, items: [{ id: 'http://example.com/maps/one' }] });
      });

      it.each([
        ['purpose among several', { purpose: ['describing', 'georeferencing'] }],
        ['motivation', { motivation: 'georeferencing' }],
      ])('trusts a page that declares georeferencing as its %s', async (_label, declaration) => {
        const PAGE_URL = 'https://example.com/annotations/declared';
        serving(manifestOf([{ id: PAGE_URL, type: 'AnnotationPage', ...declaration }]), {
          [PAGE_URL]: { type: 'AnnotationPage', items: [georeference('http://example.com/maps/one')] },
        });

        expect(await sourceWith().getGeoreferenceAnnotation()).toMatchObject({ items: [{ id: 'http://example.com/maps/one' }] });
      });

      it('does not fetch a page a later canvas links without saying what it holds', async () => {
        const PAGE_URL = 'https://example.com/annotations/transcription';
        const fetchSpy = serving(manifestOf([{ id: PAGE_URL, type: 'AnnotationPage' }]), { [PAGE_URL]: annotationFor(PAGE_URL) });

        expect(await sourceWith().getGeoreferenceAnnotation()).toBeUndefined();
        expect(fetchSpy).not.toHaveBeenCalledWith(PAGE_URL, expect.anything());
      });

      it('offers the map from pages that declare georeferencing without fetching any of them', async () => {
        const fetchSpy = serving(manifestOf([declared('https://annotations.allmaps.org/images/one')], [declared('https://annotations.allmaps.org/images/two')]));

        expect(await sourceWith().isGeoreferenced()).toBe(true);
        expect(fetchSpy).toHaveBeenCalledOnce();
      });

      it('offers the map from an annotation a later canvas carries without fetching anything else', async () => {
        const fetchSpy = serving(manifestOf([annotationFor('second-canvas')]));

        expect(await sourceWith(ANNOTATION_URL).isGeoreferenced()).toBe(true);
        expect(fetchSpy).toHaveBeenCalledOnce();
      });

      it('fetches a page that several canvases link only once, and draws each map in it once', async () => {
        const PAGE_URL = 'https://annotations.allmaps.org/manifests/shared';
        const page = { id: PAGE_URL, type: 'AnnotationPage', items: [georeference('http://example.com/maps/one')] };
        const fetchSpy = serving(manifestOf([declared(PAGE_URL)], [declared(PAGE_URL)]), { [PAGE_URL]: page });

        expect(await sourceWith().getGeoreferenceAnnotation()).toMatchObject(page);
        expect(fetchSpy.mock.calls.filter(([url]) => url === PAGE_URL)).toHaveLength(1);
      });

      it('draws a map that two pages both hold only once', async () => {
        const one = { type: 'AnnotationPage', items: [georeference('http://example.com/maps/one')] };
        const both = { type: 'AnnotationPage', items: [georeference('http://example.com/maps/one'), georeference('http://example.com/maps/two')] };
        serving(manifestOf([one], [both]));

        const annotation = await sourceWith().getGeoreferenceAnnotation();

        expect(annotation?.items?.map(item => (item as { id: string }).id)).toEqual(['http://example.com/maps/one', 'http://example.com/maps/two']);
      });

      it('keeps the maps in canvas order however the pages arrive', async () => {
        const urls = ['https://example.com/pages/1', 'https://example.com/pages/2', 'https://example.com/pages/3'];
        const delays = [30, 0, 10];
        vi.spyOn(global, 'fetch').mockImplementation(async url => {
          if (url === MANIFEST_URL) return new Response(JSON.stringify(manifestOf(...urls.map(pageUrl => [declared(pageUrl)]))));
          const index = urls.indexOf(url as string);
          await new Promise(resolve => setTimeout(resolve, delays[index]));
          return new Response(JSON.stringify({ type: 'AnnotationPage', items: [georeference(`http://example.com/maps/${index + 1}`)] }));
        });

        const annotation = await sourceWith().getGeoreferenceAnnotation();

        expect(annotation?.items?.map(item => (item as { id: string }).id)).toEqual(['http://example.com/maps/1', 'http://example.com/maps/2', 'http://example.com/maps/3']);
      });

      it('fetches every page of a long series at once', async () => {
        const urls = Array.from({ length: 40 }, (_, index) => `https://example.com/pages/${index}`);
        let inFlight = 0;
        let mostInFlight = 0;
        vi.spyOn(global, 'fetch').mockImplementation(async url => {
          if (url === MANIFEST_URL) return new Response(JSON.stringify(manifestOf(...urls.map(pageUrl => [declared(pageUrl)]))));
          inFlight++;
          mostInFlight = Math.max(mostInFlight, inFlight);
          await new Promise(resolve => setTimeout(resolve, 1));
          inFlight--;
          return new Response(JSON.stringify({ type: 'AnnotationPage', items: [georeference(`${url}#map`)] }));
        });

        const annotation = await sourceWith().getGeoreferenceAnnotation();

        expect(annotation?.items).toHaveLength(40);
        expect(mostInFlight).toBe(40);
      });

      it('draws the canvases whose pages it could read when others fail', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const GOOD_URL = 'https://example.com/pages/good';
        const page = { id: GOOD_URL, type: 'AnnotationPage', items: [georeference('http://example.com/maps/good')] };
        serving(manifestOf([declared('https://example.com/pages/missing')], [declared(GOOD_URL)]), { [GOOD_URL]: page });

        expect(await sourceWith().getGeoreferenceAnnotation()).toMatchObject(page);
        expect(warn).toHaveBeenCalledOnce();
      });

      it('falls back to a standalone annotation when no declared page can be read', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        serving(manifestOf([declared('https://example.com/pages/missing')]), { [ANNOTATION_URL]: annotationFor('standalone') });

        expect(await sourceWith(ANNOTATION_URL).getGeoreferenceAnnotation()).toEqual(annotationFor('standalone'));
      });

      describe('handing over annotations as their pages arrive', () => {
        const pageUrl = (index: number) => `https://example.com/pages/${index}`;
        const mapId = (index: number) => `http://example.com/maps/${index}`;
        const pageHolding = (...indexes: number[]) => ({ type: 'AnnotationPage', items: indexes.map(index => georeference(mapId(index))) });
        const idsIn = (annotation: any) => (annotation.type === 'AnnotationPage' ? annotation.items : [annotation]).map((item: { id: string }) => item.id);

        // Each page waits until the test releases it, so the order pages arrive in is up to the test.
        const heldPages = (count: number, holding: (index: number) => object = index => pageHolding(index)) => {
          const releases = new Map<number, () => void>();
          vi.spyOn(global, 'fetch').mockImplementation(async url => {
            if (url === MANIFEST_URL) return new Response(JSON.stringify(manifestOf(...Array.from({ length: count }, (_, index) => [declared(pageUrl(index))]))));
            const index = Array.from({ length: count }, (_, i) => pageUrl(i)).indexOf(url as string);
            await new Promise<void>(resolve => releases.set(index, resolve));
            return new Response(JSON.stringify(holding(index)));
          });

          const settle = () => new Promise(resolve => setTimeout(resolve, 0));
          const release = async (index: number) => {
            while (!releases.has(index)) await settle();
            releases.get(index)!();
            await settle();
          };
          return { release };
        };

        const handedOver = async (source: IIIFManifestResource) => {
          const annotations = [];
          for await (const annotation of source.georeferenceAnnotations()) annotations.push(annotation);
          return annotations;
        };

        // Notes the map ids of each annotation as it is handed over.
        const watching = (source: IIIFManifestResource) => {
          const handed: string[][] = [];
          void (async () => {
            for await (const annotation of source.georeferenceAnnotations()) handed.push(idsIn(annotation));
          })();
          return handed;
        };

        it('hands over the first annotation while later pages are still on their way', async () => {
          const { release } = heldPages(3);
          const source = sourceWith();
          const handed = watching(source);

          await release(0);

          expect(handed).toEqual([[mapId(0)]]);

          await release(1);
          await release(2);

          expect(handed).toEqual([[mapId(0)], [mapId(1)], [mapId(2)]]);
          expect((await source.getGeoreferenceAnnotation())?.items?.map(item => (item as { id: string }).id)).toEqual([mapId(0), mapId(1), mapId(2)]);
        });

        it('holds an annotation back until every canvas before it has been read', async () => {
          const { release } = heldPages(3);
          const handed = watching(sourceWith());

          await release(2);
          await release(1);

          expect(handed).toEqual([]);

          await release(0);

          expect(handed).toEqual([[mapId(0)], [mapId(1)], [mapId(2)]]);
        });

        it('hands over the same annotations however often it is asked, without fetching again', async () => {
          const fetchSpy = serving(manifestOf([pageHolding(1)], [pageHolding(2)]));
          const source = sourceWith();

          const first = await handedOver(source);
          const second = await handedOver(source);
          await source.getGeoreferenceAnnotation();

          expect(first).toHaveLength(2);
          second.forEach((annotation, index) => expect(annotation).toBe(first[index]));
          expect(fetchSpy).toHaveBeenCalledOnce();
        });

        it('does not hand over a map an earlier canvas already did', async () => {
          serving(manifestOf([pageHolding(1)], [pageHolding(1, 2)], [pageHolding(2)]));

          expect((await handedOver(sourceWith())).map(idsIn)).toEqual([[mapId(1)], [mapId(2)]]);
        });

        it('skips a page it cannot make sense of and reads the rest', async () => {
          const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
          serving(manifestOf([pageHolding(1)], [pageHolding(2)]));
          const source = sourceWith();
          vi.spyOn(source as any, 'resolveCanvasSources').mockImplementationOnce(() => {
            throw new Error('unreadable');
          });

          expect((await handedOver(source)).map(idsIn)).toEqual([[mapId(2)]]);
          expect(warn).toHaveBeenCalledOnce();
        });

        it('hands over a standalone annotation last', async () => {
          serving(v3Manifest, { [ANNOTATION_URL]: annotationFor('standalone') });

          expect(await handedOver(sourceWith(ANNOTATION_URL))).toEqual([annotationFor('standalone')]);
        });
      });
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

      it('points the annotations of every canvas at the image service painted on each', async () => {
        const CANVAS_2 = 'http://example.com/canvas2';
        const first = manifestWith({}, [pageOf(targeting({ id: CANVAS_ID, type: 'Canvas' }))]).items[0];
        const page = first.items[0];
        const body = { ...page.items[0].body, id: 'http://example.com/image2/full/full/0/default.jpg', service: [{ id: 'http://example.com/image2', type: 'ImageService2' }] };
        const second = {
          ...first,
          id: CANVAS_2,
          items: [{ ...page, items: [{ ...page.items[0], body }] }],
          annotations: [{ ...pageOf(targeting({ id: CANVAS_2, type: 'Canvas' })), id: 'http://example.com/georeference2' }],
        };
        vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ...v3Manifest, items: [first, second] })));

        const annotation = await sourceWith().getGeoreferenceAnnotation();

        expect(annotation).toMatchObject({
          type: 'AnnotationPage',
          items: [
            { target: { source: resolvedSource } },
            { target: { source: { id: 'http://example.com/image2', type: 'ImageService2', partOf: [{ id: CANVAS_2, type: 'Canvas' }] } } },
          ],
        });
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
