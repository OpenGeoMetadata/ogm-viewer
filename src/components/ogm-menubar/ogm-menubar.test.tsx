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
      const shadowRoot = root.shadowRoot as ShadowRoot;

      expect(shadowRoot.querySelector('.title')?.textContent?.trim()).toBe('Coho Salmon Watersheds: San Francisco Bay Area, California, 2011');
      expect(shadowRoot.querySelector('.menubar')?.className).toBe('menubar');
      expect(shadowRoot.querySelector('wa-button.menu-button wa-icon')?.getAttribute('name')).toBe('list');
    });
  });

  describe('without a record', () => {
    it('renders the bar and its button, with nothing in the title', async () => {
      const { root } = await render(<ogm-menubar></ogm-menubar>);
      const shadowRoot = root.shadowRoot as ShadowRoot;

      expect(shadowRoot.querySelector('.title')?.textContent).toBe('');
      expect(shadowRoot.querySelector('wa-button.menu-button')).not.toBeNull();
      expect(shadowRoot.querySelector('.restricted-icon')).toBeNull();
    });
  });

  describe('when hideTitle is true', () => {
    it('does not render the title', async () => {
      const record = new OgmRecord({
        id: 'stanford-ff359cr8805',
        dct_title_s: 'Coho Salmon Watersheds: San Francisco Bay Area, California, 2011',
        dct_description_sm: [],
        gbl_resourceType_sm: ['Polygon data'],
        gbl_resourceClass_sm: ['Datasets'],
        dct_accessRights_s: 'Public',
        gbl_mdVersion_s: 'Aardvark',
      });

      const { root } = await render(<ogm-menubar record={record} hideTitle={true}></ogm-menubar>);
      const shadowRoot = root.shadowRoot as ShadowRoot;

      expect(shadowRoot.querySelector('.title')).toBeNull();
    });

    it('toggles the title when the hideTitle prop changes', async () => {
      const record = new OgmRecord({
        id: 'stanford-ff359cr8805',
        dct_title_s: 'Coho Salmon Watersheds: San Francisco Bay Area, California, 2011',
        dct_description_sm: [],
        gbl_resourceType_sm: ['Polygon data'],
        gbl_resourceClass_sm: ['Datasets'],
        dct_accessRights_s: 'Public',
        gbl_mdVersion_s: 'Aardvark',
      });

      const { root, setProps } = await render(<ogm-menubar record={record} hideTitle={false}></ogm-menubar>);
      const shadowRoot = root.shadowRoot as ShadowRoot;
      expect(shadowRoot.querySelector('.title')?.textContent?.trim()).toBe('Coho Salmon Watersheds: San Francisco Bay Area, California, 2011');

      await setProps({ hideTitle: true });
      expect(shadowRoot.querySelector('.title')).toBeNull();

      await setProps({ hideTitle: false });
      expect(shadowRoot.querySelector('.title')?.textContent?.trim()).toBe('Coho Salmon Watersheds: San Francisco Bay Area, California, 2011');
    });
  });

  describe('loading indicator', () => {
    it('shows the spinner while loading', async () => {
      const { root } = await render(<ogm-menubar loading={true}></ogm-menubar>);
      const shadowRoot = root.shadowRoot as ShadowRoot;

      expect(shadowRoot.querySelector('.loading-spinner')).not.toBeNull();
    });

    it('hides the spinner when not loading', async () => {
      const { root } = await render(<ogm-menubar loading={false}></ogm-menubar>);
      const shadowRoot = root.shadowRoot as ShadowRoot;

      expect(shadowRoot.querySelector('.loading-spinner')).toBeNull();
    });

    it('toggles the spinner when the loading prop changes', async () => {
      const { root, setProps } = await render(<ogm-menubar loading={false}></ogm-menubar>);
      const shadowRoot = root.shadowRoot as ShadowRoot;
      expect(shadowRoot.querySelector('.loading-spinner')).toBeNull();

      await setProps({ loading: true });
      expect(shadowRoot.querySelector('.loading-spinner')).not.toBeNull();

      await setProps({ loading: false });
      expect(shadowRoot.querySelector('.loading-spinner')).toBeNull();
    });
  });
});
