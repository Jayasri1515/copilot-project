import { expect, test } from '@playwright/test';
import {
  interceptOpenMeteo,
  searchAndSelect,
  type ProviderScenario,
} from './support/open-meteo';

test('does not contact a provider or request geolocation at startup', async ({ page }) => {
  let geolocationCalls = 0;
  await page.addInitScript(() => {
    const original = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
    navigator.geolocation.getCurrentPosition = (...args) => {
      (window as Window & { __geoCalls?: number }).__geoCalls =
        ((window as Window & { __geoCalls?: number }).__geoCalls ?? 0) + 1;
      return original(...args);
    };
  });
  const requests = await interceptOpenMeteo(page);
  await page.goto('/');
  geolocationCalls = await page.evaluate(
    () => (window as Window & { __geoCalls?: number }).__geoCalls ?? 0,
  );
  expect(requests).toEqual({ geocoding: 0, weather: 0 });
  expect(geolocationCalls).toBe(0);
});

test('requires ambiguity selection, displays weather, refetches units, and manages persisted favorites', async ({
  page,
}) => {
  const requests = await interceptOpenMeteo(page);
  await page.goto('/');
  await page.getByLabel('City name').fill('Mumbai');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByText('2 matches found.')).toBeVisible();
  expect(requests.weather).toBe(0);
  await page.getByRole('button', { name: /Mumbai Maharashtra India/ }).click();
  await expect(
    page.getByRole('region', { name: 'Current conditions' }).getByText(/30\s*°C/),
  ).toBeVisible();

  await page.getByLabel('Fahrenheit').check();
  await expect(page.getByText(/86\s*°F/, { exact: true })).toBeVisible();
  expect(requests.weather).toBe(2);

  await page.getByRole('button', { name: 'Add to favorites' }).click();
  await expect(page.getByText('Location added to favorites.')).toBeAttached();
  await page.reload();
  await expect(page.getByLabel('Fahrenheit')).toBeChecked();
  await expect(page.getByRole('button', { name: /View weather for Mumbai/ })).toBeVisible();
  await page.getByRole('button', { name: /Remove Mumbai/ }).click();
  await expect(page.getByText('No favorite locations saved.')).toBeVisible();

  await searchAndSelect(page);
  await page.getByRole('button', { name: 'Add to favorites' }).click();
  await page.getByRole('button', { name: 'Clear all' }).click();
  await expect(page.getByText('No favorite locations saved.')).toBeVisible();
  await expect(page.getByLabel('Fahrenheit')).toBeChecked();
});

test('handles empty, Not Found, and external provider failures', async ({ page }) => {
  const scenario: ProviderScenario = { geocoding: 'not-found' };
  const requests = await interceptOpenMeteo(page, scenario);
  await page.goto('/');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Enter a city name.');
  expect(requests.geocoding).toBe(0);

  await page.getByLabel('City name').fill('Atlantis');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('City not found');

  scenario.geocoding = 'failure';
  await page.getByLabel('City name').fill('Failure');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('could not be completed');
});

test('shows incomplete data explicitly and retains stale weather after refresh failure', async ({
  page,
}) => {
  const scenario: ProviderScenario = { geocoding: 'single', weather: 'partial' };
  await interceptOpenMeteo(page, scenario);
  await page.goto('/');
  await searchAndSelect(page);
  await expect(page.getByText('Unavailable', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Forecast data for/)).toBeVisible();

  scenario.weather = 'success';
  scenario.temperature = 27;
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByText(/27\s*°C/, { exact: true })).toBeVisible();
  scenario.weather = 'failure';
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByRole('alert')).toContainText('Stale weather');
  await expect(page.getByText(/27\s*°C/, { exact: true })).toBeVisible();
});

test.describe('explicit geolocation', () => {
  test('uses a granted location only after the action', async ({ page }) => {
    await page.addInitScript(() => {
      navigator.geolocation.getCurrentPosition = (success) =>
        success({
          coords: {
            latitude: 19.07,
            longitude: 72.88,
            accuracy: 1,
            altitude: null,
            altitudeAccuracy: null,
            heading: null,
            speed: null,
            toJSON: () => ({}),
          },
          timestamp: Date.now(),
          toJSON: () => ({}),
        });
    });
    await interceptOpenMeteo(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Use my location' }).click();
    await expect(page.getByRole('heading', { name: /Current location/ })).toBeVisible();
  });

  for (const outcome of ['denied', 'timeout'] as const) {
    test(`reports geolocation ${outcome} and keeps search available`, async ({ page }) => {
      await page.addInitScript((code) => {
        navigator.geolocation.getCurrentPosition = (_success, error) =>
          error?.({
            code,
            message: 'stubbed',
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
          });
      }, outcome === 'denied' ? 1 : 3);
      await interceptOpenMeteo(page);
      await page.goto('/');
      await page.getByRole('button', { name: 'Use my location' }).click();
      await expect(page.getByRole('alert')).toContainText(
        outcome === 'denied' ? 'permission was denied' : 'timed out',
      );
      await expect(page.getByLabel('City name')).toBeEnabled();
    });
  }
});
