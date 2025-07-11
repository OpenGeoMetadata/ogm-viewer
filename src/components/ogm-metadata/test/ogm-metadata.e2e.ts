import { newE2EPage } from '@stencil/core/testing';

describe('ogm-metadata', () => {
  it('renders', async () => {
    const page = await newE2EPage();
    await page.setContent('<ogm-metadata></ogm-metadata>');

    const element = await page.find('ogm-metadata');
    expect(element).toHaveClass('hydrated');
  });
});
