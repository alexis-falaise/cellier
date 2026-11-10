import { expect, test } from '@playwright/test';

test('home renders the app name', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Cellier' })).toBeVisible();
});
