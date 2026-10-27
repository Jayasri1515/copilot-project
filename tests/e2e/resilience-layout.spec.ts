import { expect, test } from '@playwright/test';
import { interceptOpenMeteo, searchAndSelect } from './support/open-meteo';

test('reports preference storage fallback without losing search', async ({ page }) => {
  await page.addInitScript(() => {
    const getItem = Storage.prototype.getItem;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) {
      if (key.startsWith('weather-browser.preferences.v1')) throw new DOMException('blocked');
      return getItem.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('weather-browser.preferences.v1')) throw new DOMException('blocked');
      return setItem.call(this, key, value);
    };
  });
  await interceptOpenMeteo(page);
  await page.goto('/');
  await expect(page.getByText(/Browser storage is unavailable/)).toBeVisible();
  await expect(page.getByLabel('City name')).toBeEnabled();
});

test('synchronizes a persisted favorite across same-origin tabs', async ({ context, page }) => {
  const secondPage = await context.newPage();
  await interceptOpenMeteo(page, { geocoding: 'single' });
  await interceptOpenMeteo(secondPage, { geocoding: 'single' });
  await Promise.all([page.goto('/'), secondPage.goto('/')]);
  await searchAndSelect(page);
  await page.getByRole('button', { name: 'Add to favorites' }).click();
  await expect(
    secondPage.getByRole('button', { name: /View weather for Mumbai/ }),
  ).toBeVisible();
});

test('shows browser budget, provider rate-limit, and offline states without live calls', async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    const now = Date.now();
    localStorage.setItem(
      'weather-browser.request-budget.v1',
      JSON.stringify({
        version: 1,
        attempts: Array.from({ length: 100 }, (_, index) => ({
          id: `seed-${index}`,
          occurredAtEpochMs: now,
        })),
        revision: 100,
      }),
    );
  });
  const requests = await interceptOpenMeteo(page);
  await page.goto('/');
  await page.getByLabel('City name').fill('Mumbai');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('request limit');
  expect(requests.geocoding).toBe(0);

  await page.evaluate(() => localStorage.removeItem('weather-browser.request-budget.v1'));
  await page.reload();
  await page.unrouteAll();
  await interceptOpenMeteo(page, { geocoding: 'rate-limit' });
  await page.getByLabel('City name').fill('Mumbai');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('request limit');

  await context.setOffline(true);
  await expect(page.getByText('You are offline.', { exact: false })).toBeVisible();
  await page.getByLabel('City name').fill('Mumbai');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('status').first()).toContainText('Offline');
});

for (const viewport of [
  { name: '320px', width: 320, height: 720 },
  { name: 'desktop', width: 1440, height: 900 },
]) {
  test(`has no horizontal overflow at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await interceptOpenMeteo(page, { geocoding: 'single' });
    await page.goto('/');
    await searchAndSelect(page);
    const sizes = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(sizes.scroll).toBeLessThanOrEqual(sizes.client);
    await expect(page.getByRole('main')).toBeVisible();
  });
}
