import { createElement } from 'react';
import {
  BrowserClock,
  BrowserRandomSource,
  BrowserTimer,
} from '../adapters/browser';
import { LocalStorageBudgetAdapter } from '../adapters/budget';
import { BrowserGeolocationAdapter } from '../adapters/geolocation';
import {
  OpenMeteoGeocodingAdapter,
  OpenMeteoWeatherAdapter,
} from '../adapters/open-meteo';
import { PreferencesRepository } from '../adapters/storage';
import { RequestBudget } from '../application/budget';
import { FavoritesPreferencesService } from '../application/favorites';
import {
  ManualRetryGate,
  RetryEmbargoes,
  RetryPolicy,
  WeatherRequestCoordinator,
} from '../application/weather';
import { App } from '../presentation/app/App';

export function createApp() {
  const clock = new BrowserClock();
  const timer = new BrowserTimer();
  const embargoes = new RetryEmbargoes(clock);
  const retryPolicy = new RetryPolicy({
    clock,
    timer,
    random: new BrowserRandomSource(),
    embargoes,
  });
  const budget = new RequestBudget({
    clock,
    coordination: new LocalStorageBudgetAdapter(),
    embargoes,
  });
  const openMeteo = { budget, retryPolicy, clock };
  const preferences = new FavoritesPreferencesService(
    new PreferencesRepository(),
  );
  const coordinatorClock = {
    nowEpochMs: () => clock.nowEpochMs(),
    delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        const handle = timer.set(milliseconds, resolve);
        signal?.addEventListener(
          'abort',
          () => {
            timer.clear(handle);
            reject(new DOMException('Aborted', 'AbortError'));
          },
          { once: true },
        );
      });
    },
  };
  const controller = new WeatherRequestCoordinator({
    locations: new OpenMeteoGeocodingAdapter(openMeteo),
    deviceLocation: new BrowserGeolocationAdapter({ timer }),
    weather: new OpenMeteoWeatherAdapter(openMeteo),
    preferences,
    clock: coordinatorClock,
    manualRetryGate: new ManualRetryGate(clock, embargoes),
  });

  return createElement(App, { controller });
}
