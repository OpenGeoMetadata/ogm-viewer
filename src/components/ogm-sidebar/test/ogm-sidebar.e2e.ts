import { newE2EPage } from '@stencil/core/testing';

describe('ogm-sidebar', () => {
  it('renders', async () => {
    const page = await newE2EPage();
    await page.setContent('<ogm-sidebar></ogm-sidebar>');

    const element = await page.find('ogm-sidebar');
    expect(element).toHaveClass('hydrated');
  });
});
