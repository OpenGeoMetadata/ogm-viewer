import { newE2EPage } from '@stencil/core/testing';
import { OgmRecord } from '../../../utils/record';

describe('ogm-viewer', () => {
  describe('with a record with a WMS reference', () => {
    it('renders the map', async () => {
      const page = await newE2EPage({
        html: `<ogm-viewer></ogm-viewer>`,
      });
      const record = new OgmRecord({
        id: 'stanford-ff359cr8805',
        dct_title_s: 'Coho Salmon Watersheds: San Francisco Bay Area, California, 2011',
        dct_description_sm: [],
        dct_format_s: '',
        gbl_resourceType_sm: ['Polygon data'],
        gbl_resourceClass_sm: ['Datasets'],
        dct_accessRights_s: 'Public',
        gbl_mdVersion_s: 'Aardvark',
        dct_references_s: JSON.stringify({
          'http://www.opengis.net/def/serviceType/ogc/wms': 'fake-geoserver.com'
        }),
      });
      const viewerEl = await page.find('ogm-viewer');
      await viewerEl.callMethod('loadRecord', record);
      await page.waitForChanges();
      const mapEl = await page.find('ogm-viewer >>> ogm-map');
      expect(mapEl).toBeTruthy();
    });
  });

  describe('with a record with a IIIF image reference', () => {
    it('renders the IIIF image viewer', async () => {
      const page = await newE2EPage({
        html: `<ogm-viewer></ogm-viewer>`,
      });
      const record = new OgmRecord({
        id: 'stanford-ff359cr8805',
        dct_title_s: 'Coho Salmon Watersheds: San Francisco Bay Area, California, 2011',
        dct_description_sm: [],
        dct_format_s: '',
        gbl_resourceType_sm: ['Image'],
        gbl_resourceClass_sm: ['Datasets'],
        dct_accessRights_s: 'Public',
        gbl_mdVersion_s: 'Aardvark',
        dct_references_s: JSON.stringify({
          'http://iiif.io/api/image': 'https://example.com/iiif/stanford-ff359cr8805/info.json'
        }),
      });
      const viewerEl = await page.find('ogm-viewer');
      await viewerEl.callMethod('loadRecord', record);
      await page.waitForChanges();
      const iiifViewerEl = await page.find('ogm-viewer >>> ogm-image');
      expect(iiifViewerEl).toBeTruthy();
    });
  });
});
