import { newSpecPage } from '@stencil/core/testing';
import { OgmImage } from '../ogm-image';

describe('ogm-image', () => {
  it('renders', async () => {
    const page = await newSpecPage({
      components: [OgmImage],
      html: `<ogm-image></ogm-image>`,
    });
    expect(page.root).toEqualHtml(`
      <ogm-image>
        <mock:shadow-root>
          <slot></slot>
        </mock:shadow-root>
      </ogm-image>
    `);
  });
});
