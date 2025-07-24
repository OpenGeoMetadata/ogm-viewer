import { h } from '@stencil/core';
import { newSpecPage } from '@stencil/core/testing';
import { OgmMenubar } from '../ogm-menubar';
import { OgmRecord } from '../../../utils/record';

describe('ogm-menubar', () => {
  describe('with a record', () => {
    it('renders the record title', async () => {
      const record = new OgmRecord({
        id: 'stanford-ff359cr8805',
        dct_title_s: 'Coho Salmon Watersheds: San Francisco Bay Area, California, 2011',
        dct_description_sm: [],
        gbl_resourceType_sm: ['Polygon data'],
        gbl_resourceClass_sm: ['Datasets'],
        dct_accessRights_s: 'Public',
        gbl_mdVersion_s: 'Aardvark',
      });

      const page = await newSpecPage({
        components: [OgmMenubar],
        template: () => <ogm-menubar record={record}></ogm-menubar>,
      });

      expect(page.body.innerHTML).toContain('Coho Salmon Watersheds: San Francisco Bay Area, California, 2011');
    });
  });

  describe('without a record', () => {
    it('does not render anything', async () => {
      const page = await newSpecPage({
        components: [OgmMenubar],
        html: `<ogm-menubar></ogm-menubar>`,
      });

      expect(page.body).not.toContain('div class="menubar">');
    });
  });
});
