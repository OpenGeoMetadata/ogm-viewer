import { describe, it, expect, vi, afterEach } from '@stencil/vitest';
import { References } from './references';

describe('References', () => {
  afterEach(() => {
    vi.clearAllMocks(); // Reset all mocked calls between tests
  });

  describe('parsing', () => {
    it('should parse valid JSON string', () => {
      const contents = { 'http://www.opengis.net/def/serviceType/ogc/wms': 'http://example.com/wms' };
      const references = new References(JSON.stringify(contents));
      expect(references.wmsUrl).toBe('http://example.com/wms');
    });

    it('should handle invalid JSON string gracefully', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const references = new References('invalid json');
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(references.wmsUrl).toBeUndefined();
    });
  });

  describe('URLs', () => {
    it('should fetch WMS URL', () => {
      const contents = { 'http://www.opengis.net/def/serviceType/ogc/wms': 'http://example.com/wms' };
      const references = new References(JSON.stringify(contents));
      expect(references.wmsUrl).toBe('http://example.com/wms');
    });

    it('should fetch COG URL', () => {
      const contents = { 'https://github.com/cogeotiff/cog-spec': 'http://example.com/cog.tif' };
      const references = new References(JSON.stringify(contents));
      expect(references.cogUrl).toBe('http://example.com/cog.tif');
    });

    it('should fetch TMS URL', () => {
      const contents = { 'https://wiki.osgeo.org/wiki/Tile_Map_Service_Specification': 'http://example.com/tiles/{z}/{x}/{y}.png' };
      const references = new References(JSON.stringify(contents));
      expect(references.tmsUrl).toBe('http://example.com/tiles/{z}/{x}/{y}.png');
    });

    it('should fetch XYZ tiles URL', () => {
      const contents = { 'https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames': 'http://example.com/tiles/{z}/{x}/{y}.png' };
      const references = new References(JSON.stringify(contents));
      expect(references.xyzUrl).toBe('http://example.com/tiles/{z}/{x}/{y}.png');
    });

    it('should fetch GeoJSON URL', () => {
      const contents = { 'http://geojson.org/geojson-spec.html': 'http://example.com/data.geojson' };
      const references = new References(JSON.stringify(contents));
      expect(references.geojsonUrl).toBe('http://example.com/data.geojson');
    });

    it('should fetch TileJSON URL', () => {
      const contents = { 'https://github.com/mapbox/tilejson-spec': 'https://example.com/path/to/tileset.json' };
      const references = new References(JSON.stringify(contents));
      expect(references.tilejsonUrl).toBe('https://example.com/path/to/tileset.json');
    });

    it('should fetch index map URL', () => {
      const contents = { 'https://openindexmaps.org': 'http://example.com/index.geojson' };
      const references = new References(JSON.stringify(contents));
      expect(references.indexMapUrl).toBe('http://example.com/index.geojson');
    });

    it('should fetch PMTiles URL', () => {
      const contents = { 'https://github.com/protomaps/PMTiles': 'http://example.com/tiles.pmtiles' };
      const references = new References(JSON.stringify(contents));
      expect(references.pmtilesUrl).toBe('http://example.com/tiles.pmtiles');
    });

    it('should fetch WMTS URL', () => {
      const contents = { 'http://www.opengis.net/def/serviceType/ogc/wmts': 'http://example.com/wmts' };
      const references = new References(JSON.stringify(contents));
      expect(references.wmtsUrl).toBe('http://example.com/wmts');
    });

    it('should fetch IIIF image URL', () => {
      const contents = { 'http://iiif.io/api/image': 'http://example.com/image1/info.json' };
      const references = new References(JSON.stringify(contents));
      expect(references.iiifImageUrl).toBe('http://example.com/image1/info.json');
    });

    it('should fetch IIIF manifest URL', () => {
      const contents = { 'http://iiif.io/api/presentation#manifest': 'http://example.com/manifest.json' };
      const references = new References(JSON.stringify(contents));
      expect(references.iiifManifestUrl).toBe('http://example.com/manifest.json');
    });
  });

  describe('downloads', () => {
    it('should return empty links list if no download links are present', () => {
      const references = new References('{}');
      expect(references.downloadLinks).toEqual([]);
    });

    it('should return multiple download links if present', () => {
      const contents = {
        'http://schema.org/downloadUrl': [
          { url: 'http://example.com/file1.csv', label: 'CSV' },
          { url: 'http://example.com/file2.json', label: 'JSON' },
        ],
      };
      const references = new References(JSON.stringify(contents));
      expect(references.downloadLinks).toEqual(contents['http://schema.org/downloadUrl']);
    });

    it('should return empty links list if downloadUrl is a single string', () => {
      const contents = { 'http://schema.org/downloadUrl': 'http://example.com/file.csv' };
      const references = new References(JSON.stringify(contents));
      expect(references.downloadLinks).toEqual([]);
    });

    it('should return the download URL if it is a single string', () => {
      const contents = { 'http://schema.org/downloadUrl': 'http://example.com/file.csv' };
      const references = new References(JSON.stringify(contents));
      expect(references.downloadUrl).toBe('http://example.com/file.csv');
    });

    it('should return undefined for download URL if it is not present', () => {
      const references = new References('{}');
      expect(references.downloadUrl).toBeUndefined();
    });
  });

  describe('metadata links', () => {
    it('returns labelled links to metadata', () => {
      const contents = {
        'http://schema.org/downloadUrl': 'http://example.com/file.csv',
        'http://www.opengis.net/cat/csw/csdgm': 'http://example.com/fgdc.xml',
        'http://www.opengis.net/def/serviceType/ogc/wms': 'http://example.com/wms',
        'http://www.loc.gov/mods/v3': 'http://example.com/mods.xml',
      };
      const references = new References(JSON.stringify(contents));
      expect(references.metadataLinks).toEqual([
        { url: 'http://example.com/fgdc.xml', label: 'FGDC metadata' },
        { url: 'http://example.com/mods.xml', label: 'MODS metadata' },
      ]);
    });
  });

  describe('previewable', () => {
    it('should be previewable if a WMS URL is present', () => {
      const contents = { 'http://www.opengis.net/def/serviceType/ogc/wms': 'http://example.com/wms' };
      const references = new References(JSON.stringify(contents));
      expect(references.previewable).toBe(true);
    });

    it('should not be previewable if no known previewable URLs are present', () => {
      const references = new References('{}');
      expect(references.previewable).toBe(false);
    });
  });

  describe('IIIF previewable', () => {
    it('should be IIIF previewable if an IIIF image URL is present', () => {
      const contents = { 'http://iiif.io/api/image': 'http://example.com/image1/info.json' };
      const references = new References(JSON.stringify(contents));
      expect(references.iiifPreviewable).toBe(true);
    });

    it('should be IIIF previewable if an IIIF manifest URL is present', () => {
      const contents = { 'http://iiif.io/api/presentation#manifest': 'http://example.com/manifest.json' };
      const references = new References(JSON.stringify(contents));
      expect(references.iiifPreviewable).toBe(true);
    });

    it('should not be IIIF previewable if no IIIF URLs are present', () => {
      const contents = { 'http://www.opengis.net/def/serviceType/ogc/wms': 'http://example.com/wms' };
      const references = new References(JSON.stringify(contents));
      expect(references.iiifPreviewable).toBe(false);
    });
  });

  describe('IIIF only', () => {
    it('should be IIIF only if it has IIIF URLs but no other previewable URLs', () => {
      const contents = { 'http://iiif.io/api/image': 'http://example.com/image1/info.json' };
      const references = new References(JSON.stringify(contents));
      expect(references.iiifOnly).toBe(true);
    });

    it('should not be IIIF only if it has non-IIIF previewable URLs', () => {
      const contents = {
        'http://iiif.io/api/image': 'http://example.com/image1/info.json',
        'http://www.opengis.net/def/serviceType/ogc/wms': 'http://example.com/wms',
      };
      const references = new References(JSON.stringify(contents));
      expect(references.iiifOnly).toBe(false);
    });

    it('should not be IIIF only if it has no IIIF previewable URLs', () => {
      const contents = { 'http://www.opengis.net/def/serviceType/ogc/wms': 'http://example.com/wms' };
      const references = new References(JSON.stringify(contents));
      expect(references.iiifOnly).toBe(false);
    });
  });

  describe('Map previewable', () => {
    it('should be map previewable if a TMS URL is present', () => {
      const contents = { 'https://wiki.osgeo.org/wiki/Tile_Map_Service_Specification': 'http://example.com/tiles/{z}/{x}/{y}.png' };
      const references = new References(JSON.stringify(contents));
      expect(references.mapPreviewable).toBe(true);
    });

    it('should be map previewable if an XYZ tiles URL is present', () => {
      const contents = { 'https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames': 'http://example.com/tiles/{z}/{x}/{y}.png' };
      const references = new References(JSON.stringify(contents));
      expect(references.mapPreviewable).toBe(true);
    });

    it('should not be map previewable if only a IIIF Image URL is present', () => {
      const contents = { 'http://iiif.io/api/image': 'http://example.com/image1/info.json' };
      const references = new References(JSON.stringify(contents));
      expect(references.mapPreviewable).toBe(false);
    });

    // See https://github.com/OpenGeoMetadata/ogm-viewer/issues/80
    it.todo('should be map previewable if there are IIIF georeference annotations in the manifest');
  });
});
