import { h } from '@stencil/core';
import { newSpecPage } from '@stencil/core/testing';
import { OgmIiif } from '../ogm-iiif';

describe('ogm-iiif', () => {
  describe('with no manifestUrl', () => {
    it('does not render anything', async () => {
      const page = await newSpecPage({
        components: [OgmIiif],
        template: () => <ogm-iiif></ogm-iiif>,
      });

      expect(page.root).toEqualHtml(`
        <ogm-iiif>
        </ogm-iiif>
      `);
    });
  });

  describe('with empty manifestUrl', () => {
    it('does not render anything', async () => {
      const page = await newSpecPage({
        components: [OgmIiif],
        template: () => <ogm-iiif manifestUrl=""></ogm-iiif>,
      });

      // Empty string is falsy, so component doesn't render (same as no manifestUrl)
      expect(page.root.querySelector('iframe')).toBeNull();
      expect(page.root.querySelector('.wrapper')).toBeNull();
    });
  });

  describe('with a manifestUrl', () => {
    it('renders iframe with correct attributes', async () => {
      const manifestUrl = 'https://example.com/manifest.json';
      const page = await newSpecPage({
        components: [OgmIiif],
        template: () => <ogm-iiif manifestUrl={manifestUrl}></ogm-iiif>,
      });

      const iframe = page.root.querySelector('iframe');
      expect(iframe).toBeTruthy();
      expect(iframe.getAttribute('class')).toBe('clover-frame');
      expect(iframe.getAttribute('title')).toBe('Clover IIIF Viewer');
      expect(iframe.getAttribute('loading')).toBe('lazy');
      expect(iframe.getAttribute('part')).toBe('clover-frame');
    });

    it('includes Clover UMD script in srcdoc', async () => {
      const manifestUrl = 'https://example.com/manifest.json';
      const page = await newSpecPage({
        components: [OgmIiif],
        template: () => <ogm-iiif manifestUrl={manifestUrl}></ogm-iiif>,
      });

      const iframe = page.root.querySelector('iframe');
      const srcdoc = iframe.getAttribute('srcdoc');
      expect(srcdoc).toContain('https://www.unpkg.com/@samvera/clover-iiif@latest/dist/web-components/index.umd.js');
    });

    it('includes clover-viewer element with correct iiif-content attribute', async () => {
      const manifestUrl = 'https://example.com/manifest.json';
      const page = await newSpecPage({
        components: [OgmIiif],
        template: () => <ogm-iiif manifestUrl={manifestUrl}></ogm-iiif>,
      });

      const iframe = page.root.querySelector('iframe');
      const srcdoc = iframe.getAttribute('srcdoc');
      expect(srcdoc).toContain('<clover-viewer');
      expect(srcdoc).toContain('iiif-content="https://example.com/manifest.json"');
    });

    it('escapes URL properly in srcdoc', async () => {
      const manifestUrl = 'https://example.com/manifest.json?param=value&other=test';
      const page = await newSpecPage({
        components: [OgmIiif],
        template: () => <ogm-iiif manifestUrl={manifestUrl}></ogm-iiif>,
      });

      const iframe = page.root.querySelector('iframe');
      const srcdoc = iframe.getAttribute('srcdoc');
      expect(srcdoc).toContain('&amp;');
      expect(srcdoc).not.toContain('&other=');
    });

    it('includes CSS to hide clover-viewer-header', async () => {
      const manifestUrl = 'https://example.com/manifest.json';
      const page = await newSpecPage({
        components: [OgmIiif],
        template: () => <ogm-iiif manifestUrl={manifestUrl}></ogm-iiif>,
      });

      const iframe = page.root.querySelector('iframe');
      const srcdoc = iframe.getAttribute('srcdoc');
      expect(srcdoc).toContain('.clover-viewer-header');
      expect(srcdoc).toContain('display: none !important');
    });

    it('includes script to close info panel', async () => {
      const manifestUrl = 'https://example.com/manifest.json';
      const page = await newSpecPage({
        components: [OgmIiif],
        template: () => <ogm-iiif manifestUrl={manifestUrl}></ogm-iiif>,
      });

      const iframe = page.root.querySelector('iframe');
      const srcdoc = iframe.getAttribute('srcdoc');
      expect(srcdoc).toContain('information-toggle');
      expect(srcdoc).toContain('MutationObserver');
    });

    it('shows loading spinner initially', async () => {
      const manifestUrl = 'https://example.com/manifest.json';
      const page = await newSpecPage({
        components: [OgmIiif],
        template: () => <ogm-iiif manifestUrl={manifestUrl}></ogm-iiif>,
      });

      const spinner = page.root.querySelector('sl-spinner');
      expect(spinner).toBeTruthy();
      const loadingDiv = page.root.querySelector('.loading');
      expect(loadingDiv).toBeTruthy();
    });
  });

  describe('with theme prop', () => {
    it('applies light theme class', async () => {
      const manifestUrl = 'https://example.com/manifest.json';
      const page = await newSpecPage({
        components: [OgmIiif],
        template: () => <ogm-iiif manifestUrl={manifestUrl} theme="light"></ogm-iiif>,
      });

      expect(page.root.getAttribute('class')).toBe('sl-theme-light');

      const iframe = page.root.querySelector('iframe');
      const srcdoc = iframe.getAttribute('srcdoc');
      expect(srcdoc).toContain('sl-theme-light');
    });

    it('applies dark theme class', async () => {
      const manifestUrl = 'https://example.com/manifest.json';
      const page = await newSpecPage({
        components: [OgmIiif],
        template: () => <ogm-iiif manifestUrl={manifestUrl} theme="dark"></ogm-iiif>,
      });

      expect(page.root.getAttribute('class')).toBe('sl-theme-dark');

      const iframe = page.root.querySelector('iframe');
      const srcdoc = iframe.getAttribute('srcdoc');
      expect(srcdoc).toContain('sl-theme-dark');
    });

    it('handles missing theme prop gracefully', async () => {
      const manifestUrl = 'https://example.com/manifest.json';
      const page = await newSpecPage({
        components: [OgmIiif],
        template: () => <ogm-iiif manifestUrl={manifestUrl}></ogm-iiif>,
      });

      expect(page.root.getAttribute('class')).toBeNull();

      const iframe = page.root.querySelector('iframe');
      const srcdoc = iframe.getAttribute('srcdoc');
      expect(srcdoc).toContain('<body class="">');
    });
  });

  describe('with loadError state', () => {
    it('does not render when loadError is true', async () => {
      const manifestUrl = 'https://example.com/manifest.json';
      const page = await newSpecPage({
        components: [OgmIiif],
        template: () => <ogm-iiif manifestUrl={manifestUrl}></ogm-iiif>,
      });

      // Set loadError state
      page.rootInstance.loadError = true;
      await page.waitForChanges();

      expect(page.root.querySelector('iframe')).toBeNull();
      expect(page.root.querySelector('.wrapper')).toBeNull();
    });
  });

  describe('wrapper structure', () => {
    it('renders wrapper div with correct structure', async () => {
      const manifestUrl = 'https://example.com/manifest.json';
      const page = await newSpecPage({
        components: [OgmIiif],
        template: () => <ogm-iiif manifestUrl={manifestUrl}></ogm-iiif>,
      });

      const wrapper = page.root.querySelector('.wrapper');
      expect(wrapper).toBeTruthy();
      expect(wrapper.querySelector('iframe')).toBeTruthy();
      expect(wrapper.querySelector('.loading')).toBeTruthy();
    });
  });
});
