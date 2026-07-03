import { render, describe, it, expect, h } from '@stencil/vitest';

import OgmRecord from '../../lib/record';

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

      const { root } = await render(<ogm-menubar record={record}></ogm-menubar>);

      expect(root).toEqualHtml(`
        <ogm-menubar class="hydrated">
          <mock:shadow-root>
            <div class="menubar undefined">
              <wa-button appearance="plain" class="menu-button">
                <wa-icon name="list" label="Open sidebar" canvas="auto"></wa-icon>
              </wa-button>
              <div class="title">
                Coho Salmon Watersheds: San Francisco Bay Area, California, 2011
              </div>
            </div>
          </mock:shadow-root>
        </ogm-menubar>
      `);
    });
  });

  describe('without a record', () => {
    it('does not render anything', async () => {
      const { root } = await render(<ogm-menubar></ogm-menubar>);

      expect(root).toEqualHtml(`
        <ogm-menubar class="hydrated">
          <mock:shadow-root>
            <div class="menubar undefined">
              <wa-button appearance="plain" class="menu-button">
                <wa-icon name="list" label="Open sidebar" canvas="auto"></wa-icon>
              </wa-button>
              <div class="title"></div>
            </div>
          </mock:shadow-root>
        </ogm-menubar>
      `);
    });
  });
});
