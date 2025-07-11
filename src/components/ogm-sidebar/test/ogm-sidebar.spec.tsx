import { newSpecPage } from '@stencil/core/testing';
import { OgmSidebar } from '../ogm-sidebar';

describe('ogm-sidebar', () => {
  it('renders', async () => {
    const page = await newSpecPage({
      components: [OgmSidebar],
      html: `<ogm-sidebar></ogm-sidebar>`,
    });
    expect(page.root).toEqualHtml(`
      <ogm-sidebar>
        <mock:shadow-root>
          <slot></slot>
        </mock:shadow-root>
      </ogm-sidebar>
    `);
  });
});
