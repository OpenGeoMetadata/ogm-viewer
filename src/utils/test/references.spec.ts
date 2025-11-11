import { References } from '../references';

describe('References', () => {
  describe('iiifManifest getter', () => {
    it('returns undefined when no manifest URL exists', () => {
      const references = new References('{}');
      expect(references.iiifManifest).toBeUndefined();
    });

    it('returns manifest URL unchanged for standard URLs', () => {
      const manifestUrl = 'https://example.com/manifest.json';
      const references = new References(
        JSON.stringify({
          'http://iiif.io/api/presentation#manifest': manifestUrl,
        }),
      );
      expect(references.iiifManifest).toBe(manifestUrl);
    });

    it('normalizes U-Michigan search URLs to manifest URLs', () => {
      const searchUrl = 'https://quod.lib.umich.edu/cgi/i/image/api/search/clark1ic:010356232';
      const expectedManifestUrl = 'https://quod.lib.umich.edu/cgi/i/image/api/manifest/clark1ic:010356232';
      const references = new References(
        JSON.stringify({
          'http://iiif.io/api/presentation#manifest': searchUrl,
        }),
      );
      expect(references.iiifManifest).toBe(expectedManifestUrl);
    });

    it('does not normalize U-Michigan URLs that are already manifest URLs', () => {
      const manifestUrl = 'https://quod.lib.umich.edu/cgi/i/image/api/manifest/clark1ic:010356232';
      const references = new References(
        JSON.stringify({
          'http://iiif.io/api/presentation#manifest': manifestUrl,
        }),
      );
      expect(references.iiifManifest).toBe(manifestUrl);
    });

    it('does not normalize non-U-Michigan URLs with search in path', () => {
      const searchUrl = 'https://other-library.edu/api/search/manifest123';
      const references = new References(
        JSON.stringify({
          'http://iiif.io/api/presentation#manifest': searchUrl,
        }),
      );
      expect(references.iiifManifest).toBe(searchUrl);
    });

    it('works alongside other reference getters', () => {
      const references = new References(
        JSON.stringify({
          'http://iiif.io/api/presentation#manifest': 'https://example.com/manifest.json',
          'http://www.opengis.net/def/serviceType/ogc/wms': 'https://example.com/wms',
          'https://github.com/cogeotiff/cog-spec': 'https://example.com/cog.tif',
        }),
      );
      expect(references.iiifManifest).toBe('https://example.com/manifest.json');
      expect(references.wms).toBe('https://example.com/wms');
      expect(references.cog).toBe('https://example.com/cog.tif');
    });
  });

  describe('error handling', () => {
    it('handles malformed JSON gracefully', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const references = new References('invalid json');
      expect(references.iiifManifest).toBeUndefined();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('handles empty string gracefully', () => {
      const references = new References('');
      expect(references.iiifManifest).toBeUndefined();
    });
  });

  describe('URL normalization edge cases', () => {
    it('handles U-Michigan URL with query parameters', () => {
      const searchUrl = 'https://quod.lib.umich.edu/cgi/i/image/api/search/clark1ic:010356232?param=value';
      const expectedManifestUrl = 'https://quod.lib.umich.edu/cgi/i/image/api/manifest/clark1ic:010356232?param=value';
      const references = new References(
        JSON.stringify({
          'http://iiif.io/api/presentation#manifest': searchUrl,
        }),
      );
      expect(references.iiifManifest).toBe(expectedManifestUrl);
    });

    it('handles U-Michigan URL with hash fragments', () => {
      const searchUrl = 'https://quod.lib.umich.edu/cgi/i/image/api/search/clark1ic:010356232#fragment';
      const expectedManifestUrl = 'https://quod.lib.umich.edu/cgi/i/image/api/manifest/clark1ic:010356232#fragment';
      const references = new References(
        JSON.stringify({
          'http://iiif.io/api/presentation#manifest': searchUrl,
        }),
      );
      expect(references.iiifManifest).toBe(expectedManifestUrl);
    });
  });
});

