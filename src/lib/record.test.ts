import { describe, it, expect, vi } from '@stencil/vitest';
import { OgmRecord } from './record';
import { LngLatBounds } from 'maplibre-gl';

describe('OgmRecord', () => {
  it('errors when initialized with an unsupported version', () => {
    expect(() => {
      new OgmRecord({
        id: '1',
        dct_title_s: 'Test Record',
        gbl_resourceClass_sm: ['Datasets'],
        dct_accessRights_s: 'Public',
        // @ts-ignore
        gbl_mdVersion_s: 'UnsupportedVersion',
      });
    }).toThrow('Unsupported metadata version: UnsupportedVersion');
  });

  describe('attribution', () => {
    it('should return rightsHolder if available', () => {
      const record = new OgmRecord({
        id: '1',
        dct_title_s: 'Test Record',
        gbl_resourceClass_sm: ['Datasets'],
        dct_accessRights_s: 'Public',
        dct_rightsHolder_sm: ['Some Organization'],
        gbl_mdVersion_s: 'Aardvark',
      });
      expect(record.attribution).toBe('Some Organization');
    });

    it('should return publishers if rightsHolder is not available', () => {
      const record = new OgmRecord({
        id: '1',
        dct_title_s: 'Test Record',
        gbl_resourceClass_sm: ['Datasets'],
        dct_accessRights_s: 'Public',
        dct_publisher_sm: ['Publisher 1', 'Publisher 2'],
        gbl_mdVersion_s: 'Aardvark',
      });
      expect(record.attribution).toBe('Publisher 1; Publisher 2');
    });

    it('should return provider if rightsHolder and publishers are not available', () => {
      const record = new OgmRecord({
        id: '1',
        dct_title_s: 'Test Record',
        gbl_resourceClass_sm: ['Datasets'],
        dct_accessRights_s: 'Public',
        schema_provider_s: 'Test Provider',
        gbl_mdVersion_s: 'Aardvark',
      });
      expect(record.attribution).toBe('Test Provider');
    });

    it('should be undefined if no attribution information is available', () => {
      const record = new OgmRecord({
        id: '1',
        dct_title_s: 'Test Record',
        gbl_resourceClass_sm: ['Datasets'],
        dct_accessRights_s: 'Public',
        gbl_mdVersion_s: 'Aardvark',
      });
      expect(record.attribution).toBeUndefined();
    });
  });

  describe('downloadLinks', () => {
    it('should use multiple downloads from references if present', () => {
      const record = new OgmRecord({
        id: '1',
        dct_title_s: 'Test Record',
        gbl_resourceClass_sm: ['Datasets'],
        dct_accessRights_s: 'Public',
        dct_references_s: JSON.stringify({
          'http://schema.org/downloadUrl': [
            { url: 'http://example.com/file1.csv', label: 'CSV' },
            { url: 'http://example.com/file2.json', label: 'JSON' },
          ],
        }),
        gbl_mdVersion_s: 'Aardvark',
      });
      expect(record.downloadLinks).toEqual([
        { url: 'http://example.com/file1.csv', label: 'CSV' },
        { url: 'http://example.com/file2.json', label: 'JSON' },
      ]);
    });

    it('should use format to label the link if it is a single string', () => {
      const record = new OgmRecord({
        id: '1',
        dct_title_s: 'Test Record',
        gbl_resourceClass_sm: ['Datasets'],
        dct_accessRights_s: 'Public',
        dct_format_s: 'CSV',
        dct_references_s: JSON.stringify({
          'http://schema.org/downloadUrl': 'http://example.com/file.csv',
        }),
        gbl_mdVersion_s: 'Aardvark',
      });
      expect(record.downloadLinks).toEqual([{ url: 'http://example.com/file.csv', label: 'CSV' }]);
    });

    it('should include the file size in the label if available', () => {
      const record = new OgmRecord({
        id: '1',
        dct_title_s: 'Test Record',
        gbl_resourceClass_sm: ['Datasets'],
        dct_accessRights_s: 'Public',
        dct_format_s: 'CSV',
        gbl_fileSize_s: '10 MB',
        dct_references_s: JSON.stringify({
          'http://schema.org/downloadUrl': 'http://example.com/file.csv',
        }),
        gbl_mdVersion_s: 'Aardvark',
      });
      expect(record.downloadLinks).toEqual([{ url: 'http://example.com/file.csv', label: 'CSV (10 MB)' }]);
    });

    it('should use a generic label if format is not available', () => {
      const record = new OgmRecord({
        id: '1',
        dct_title_s: 'Test Record',
        gbl_resourceClass_sm: ['Datasets'],
        dct_accessRights_s: 'Public',
        dct_references_s: JSON.stringify({
          'http://schema.org/downloadUrl': 'http://example.com/file',
        }),
        gbl_mdVersion_s: 'Aardvark',
      });
      expect(record.downloadLinks).toEqual([{ url: 'http://example.com/file', label: 'Object' }]);
    });

    it('should be empty array if there are no download links', () => {
      const record = new OgmRecord({
        id: '1',
        dct_title_s: 'Test Record',
        gbl_resourceClass_sm: ['Datasets'],
        dct_accessRights_s: 'Public',
        gbl_mdVersion_s: 'Aardvark',
      });
      expect(record.downloadLinks).toEqual([]);
    });
  });

  describe('getBounds', () => {
    it('should be empty if there is no bbox', () => {
      const record = new OgmRecord({
        id: '1',
        dct_title_s: 'Test Record',
        gbl_resourceClass_sm: ['Datasets'],
        dct_accessRights_s: 'Public',
        gbl_mdVersion_s: 'Aardvark',
      });
      expect(record.getBounds()).toBeUndefined();
    });

    it('should convert ENVELOPE bbox to LngLatBounds', () => {
      const record = new OgmRecord({
        id: '1',
        dct_title_s: 'Test Record',
        gbl_resourceClass_sm: ['Datasets'],
        dct_accessRights_s: 'Public',
        dcat_bbox: 'ENVELOPE(-20,-15,-5,-1)',
        gbl_mdVersion_s: 'Aardvark',
      });
      expect(record.getBounds()).toEqual(new LngLatBounds([-20, -1], [-15, -5]));
    });
  });

  describe('restricted', () => {
    it('should return true if access rights is Restricted', () => {
      const record = new OgmRecord({
        id: '1',
        dct_title_s: 'Test Record',
        gbl_resourceClass_sm: ['Datasets'],
        dct_accessRights_s: 'Restricted',
        gbl_mdVersion_s: 'Aardvark',
      });
      expect(record.restricted).toBe(true);
    });

    it('should return false if access rights is Public', () => {
      const record = new OgmRecord({
        id: '1',
        dct_title_s: 'Test Record',
        gbl_resourceClass_sm: ['Datasets'],
        dct_accessRights_s: 'Public',
        gbl_mdVersion_s: 'Aardvark',
      });
      expect(record.restricted).toBe(false);
    });
  });

  describe('getGeometry', () => {
    it('should return GeoJSON from locn_geometry', () => {
      const record = new OgmRecord({
        id: '1',
        dct_title_s: 'Test Record',
        gbl_resourceClass_sm: ['Datasets'],
        dct_accessRights_s: 'Public',
        locn_geometry: 'POLYGON((19.08 70.09, 31.59 70.09, 31.59 59.45, 19.08 59.45, 19.08 70.09))',
        gbl_mdVersion_s: 'Aardvark',
      });

      const geojson = record.getGeometry();
      expect(geojson).toEqual({
        type: 'Polygon',
        coordinates: [
          [
            [19.08, 70.09],
            [31.59, 70.09],
            [31.59, 59.45],
            [19.08, 59.45],
            [19.08, 70.09],
          ],
        ],
      });
    });

    it('should be undefined if locn_geometry cannot be parsed', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const record = new OgmRecord({
        id: '1',
        dct_title_s: 'Test Record',
        gbl_resourceClass_sm: ['Datasets'],
        dct_accessRights_s: 'Public',
        locn_geometry: 'INVALID(-122.6764 45.5165)',
        gbl_mdVersion_s: 'Aardvark',
      });

      const geojson = record.getGeometry();
      expect(geojson).toBeUndefined();
      expect(consoleWarnSpy).toHaveBeenCalledWith('Could not parse geometry:', 'INVALID(-122.6764 45.5165)');
      consoleWarnSpy.mockRestore();
    });

    it('should return GeoJSON from dcat_bbox', () => {
      const record = new OgmRecord({
        id: '2',
        dct_title_s: 'Test Record with BBox',
        gbl_resourceClass_sm: ['Datasets'],
        dct_accessRights_s: 'Public',
        dcat_bbox: 'ENVELOPE(-20,-15,-5,-1)',
        gbl_mdVersion_s: 'Aardvark',
      });

      const geojson = record.getGeometry();
      expect(geojson).toEqual({
        type: 'Polygon',
        coordinates: [
          [
            [-20, -1],
            [-15, -1],
            [-15, -5],
            [-20, -5],
            [-20, -1],
          ],
        ],
      });
    });

    it('should be undefined if dcat_bbox cannot be parsed', () => {
      const record = new OgmRecord({
        id: '2',
        dct_title_s: 'Test Record with Invalid BBox',
        gbl_resourceClass_sm: ['Datasets'],
        dct_accessRights_s: 'Public',
        dcat_bbox: 'INVALID(-20,-15,-5,-1)',
        gbl_mdVersion_s: 'Aardvark',
      });

      const geojson = record.getGeometry();
      expect(geojson).toBeUndefined();
    });

    it('should prefer locn_geometry over dcat_bbox', () => {
      const record = new OgmRecord({
        id: '3',
        dct_title_s: 'Test Record with Both Geometries',
        gbl_resourceClass_sm: ['Datasets'],
        dct_accessRights_s: 'Public',
        locn_geometry: 'POINT(-122.6764 45.5165)',
        dcat_bbox: 'ENVELOPE(-20,-15,-5,-1)',
        gbl_mdVersion_s: 'Aardvark',
      });

      const geojson = record.getGeometry();
      expect(geojson).toEqual({
        type: 'Point',
        coordinates: [-122.6764, 45.5165],
      });
    });
  });
});
