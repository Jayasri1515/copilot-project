import { expect, type Page, type Route } from '@playwright/test';

export interface ProviderScenario {
  geocoding?: 'ambiguous' | 'single' | 'not-found' | 'failure' | 'rate-limit';
  weather?: 'success' | 'partial' | 'failure' | 'rate-limit';
  weatherDelayMs?: number;
  temperature?: number;
}

export interface ProviderRequests {
  geocoding: number;
  weather: number;
}

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' };

export const mumbai = {
  id: 1275339,
  name: 'Mumbai',
  latitude: 19.07283,
  longitude: 72.88261,
  timezone: 'Asia/Kolkata',
  country: 'India',
  admin1: 'Maharashtra',
};

function dates(): string[] {
  const today = new Date();
  return [0, 1, 2, 3].map((offset) => {
    const value = new Date(Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate() + offset,
    ));
    return value.toISOString().slice(0, 10);
  });
}

function weatherPayload(
  unit: string,
  scenario: ProviderScenario['weather'],
  temperature = unit === 'fahrenheit' ? 86 : 30,
) {
  const symbol = unit === 'fahrenheit' ? '°F' : '°C';
  const partial = scenario === 'partial';
  return {
    latitude: 19.07283,
    longitude: 72.88261,
    elevation: 8,
    timezone: 'UTC',
    current_units: {
      temperature_2m: symbol,
      relative_humidity_2m: '%',
      weather_code: 'wmo code',
    },
    current: {
      temperature_2m: temperature,
      relative_humidity_2m: partial ? null : 70,
      weather_code: partial ? null : 2,
    },
    daily_units: {
      weather_code: 'wmo code',
      temperature_2m_max: symbol,
      temperature_2m_min: symbol,
    },
    daily: {
      time: partial ? dates().slice(0, 2) : dates(),
      weather_code: partial ? [2, 2] : [2, 1, 3, 61],
      temperature_2m_max: partial ? [32, null] : [32, 31, 30, 29],
      temperature_2m_min: partial ? [25, 24] : [25, 24, 23, 22],
    },
  };
}

async function fulfillFailure(route: Route, status: number) {
  await route.fulfill({
    status,
    headers: {
      ...jsonHeaders,
      ...(status === 429 ? { 'retry-after': '60' } : {}),
    },
    body: JSON.stringify({ error: true, reason: 'stubbed failure' }),
  });
}

/** Installs deterministic provider interception. No request reaches Open-Meteo. */
export async function interceptOpenMeteo(
  page: Page,
  scenario: ProviderScenario = {},
): Promise<ProviderRequests> {
  const requests: ProviderRequests = { geocoding: 0, weather: 0 };
  await page.route('https://geocoding-api.open-meteo.com/**', async (route) => {
    requests.geocoding += 1;
    const mode = scenario.geocoding ?? 'ambiguous';
    if (mode === 'failure' || mode === 'rate-limit') {
      await fulfillFailure(route, mode === 'rate-limit' ? 429 : 400);
      return;
    }
    const results =
      mode === 'not-found'
        ? []
        : mode === 'single'
          ? [mumbai]
          : [
              mumbai,
              {
                id: 5128581,
                name: 'Mumbai',
                latitude: 40.71,
                longitude: -74.01,
                timezone: 'America/New_York',
                country: 'United States',
                admin1: 'New York',
              },
            ];
    await route.fulfill({
      status: 200,
      headers: jsonHeaders,
      body: JSON.stringify({ results }),
    });
  });
  await page.route('https://api.open-meteo.com/**', async (route) => {
    requests.weather += 1;
    if (scenario.weatherDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, scenario.weatherDelayMs));
    }
    const mode = scenario.weather ?? 'success';
    if (mode === 'failure' || mode === 'rate-limit') {
      await fulfillFailure(route, mode === 'rate-limit' ? 429 : 400);
      return;
    }
    const url = new URL(route.request().url());
    await route.fulfill({
      status: 200,
      headers: jsonHeaders,
      body: JSON.stringify(
        weatherPayload(
          url.searchParams.get('temperature_unit') ?? 'celsius',
          mode,
          scenario.temperature,
        ),
      ),
    });
  });
  return requests;
}

export async function searchAndSelect(page: Page, query = 'Mumbai') {
  await page.getByLabel('City name').fill(query);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const choice = page.getByRole('button', {
    name: /Mumbai Maharashtra India/,
  });
  const heading = page.getByRole('heading', {
    name: /Mumbai, Maharashtra, India/,
  });
  await Promise.race([
    choice.waitFor({ state: 'visible' }),
    heading.waitFor({ state: 'visible' }),
  ]);
  if (await choice.isVisible()) await choice.click();
  await expect(heading).toBeVisible();
}
