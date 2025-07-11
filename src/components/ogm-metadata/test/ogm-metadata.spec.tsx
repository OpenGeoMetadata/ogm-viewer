import { newSpecPage } from '@stencil/core/testing';
import { OgmMetadata } from '../ogm-metadata';

describe('ogm-metadata', () => {
  it('renders', async () => {
    const page = await newSpecPage({
      components: [OgmMetadata],
      html: `<ogm-metadata></ogm-metadata>`,
    });
    expect(page.root).toEqualHtml(`
      <ogm-metadata>
        <mock:shadow-root>
          <slot></slot>
        </mock:shadow-root>
      </ogm-metadata>
    `);
  });
});
