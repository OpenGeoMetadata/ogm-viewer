import { expect } from '@playwright/test';
import { test } from '@stencil/playwright';

test.describe('viewing a geoJSON record', () => {
  test('should show the metadata in the sidebar', async ({ page }) => {
    await page.goto('/geojson');
    const metadata = page.locator('.metadata');
    await expect(metadata).toContainText('id: 1');
    await expect(metadata).toContainText('name: Test GeoJSON');
  });
})
