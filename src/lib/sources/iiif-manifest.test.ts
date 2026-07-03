import { describe, it, expect, vi, afterEach } from '@stencil/vitest';

import IIIFManifestSource from './iiif-manifest';

const MANIFEST_URL = 'http://example.com/manifest.json';

// A source always points at a manifest URL; the manifest itself is fetched lazily
const createSource = () => new IIIFManifestSource('test-id', MANIFEST_URL);

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

describe('IIIFManifestSource', () => {
  afterEach(() => vi.restoreAllMocks());

  describe('getIIIFImageUrls', () => {
    it('should fetch and extract image URLs from a IIIF v2 manifest', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify(v2Manifest)));
      const urls = await createSource().getIIIFImageUrls();
      expect(fetchSpy).toHaveBeenCalledWith(MANIFEST_URL);
      expect(urls).toEqual(['http://example.com/image1/info.json']);
    });

    it('should fetch and extract image URLs from a IIIF v3 manifest', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify(v3Manifest)));
      const urls = await createSource().getIIIFImageUrls();
      expect(fetchSpy).toHaveBeenCalledWith(MANIFEST_URL);
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

    it('should throw if the manifest response is not ok', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce(new Response('Not found', { status: 404, statusText: 'Not Found' }));
      await expect(createSource().getIIIFImageUrls()).rejects.toThrow('Unexpected response fetching IIIF manifest');
    });

    it('should throw if the manifest is not valid JSON', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce(new Response('invalid json'));
      await expect(createSource().getIIIFImageUrls()).rejects.toThrow();
    });

    it('should throw if the manifest does not match the IIIF spec', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ unexpected: 'structure' })));
      await expect(createSource().getIIIFImageUrls()).rejects.toThrow();
    });
  });
});
