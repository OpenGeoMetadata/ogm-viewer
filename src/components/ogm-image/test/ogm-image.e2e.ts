import { newE2EPage } from '@stencil/core/testing';

describe('ogm-image', () => {
  it('renders', async () => {
    const page = await newE2EPage();
    await page.setContent('<ogm-image></ogm-image>');

    const element = await page.find('ogm-image');
    expect(element).toHaveClass('hydrated');
  });
});
