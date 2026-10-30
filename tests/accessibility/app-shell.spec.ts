import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { interceptOpenMeteo } from '../e2e/support/open-meteo';

test('meets automated WCAG 2.2 AA checks in empty and populated states', async ({ page }) => {
  await interceptOpenMeteo(page, { geocoding: 'single' });
  await page.goto('/');
  for (const state of ['empty', 'weather']) {
    if (state === 'weather') {
      await page.getByLabel('City name').fill('Mumbai');
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      await expect(page.getByRole('heading', { name: /Mumbai/ })).toBeVisible();
    }
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(result.violations, `${state} accessibility violations`).toEqual([]);
  }
});

test('supports keyboard flow, visible focus, focus movement, and live announcements', async ({
  page,
}) => {
  await interceptOpenMeteo(page);
  await page.goto('/');
  const skipLink = page.getByRole('link', { name: 'Skip to weather content' });
  await skipLink.focus();
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();

  await page.getByLabel('City name').focus();
  await page.keyboard.type('Mumbai');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /Mumbai Maharashtra India/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: /Mumbai, Maharashtra, India/ })).toBeFocused();
  await expect(page.getByRole('status').first()).toContainText('Weather updated');
});
