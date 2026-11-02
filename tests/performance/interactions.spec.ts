import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { expect, test } from '@playwright/test';
import { interceptOpenMeteo } from '../e2e/support/open-meteo';

interface RunMeasurement {
  run: number;
  inp: number;
  feedback: Record<string, number>;
  eventDurations: number[];
}

test('@interaction records 20 cold representative interaction runs', async ({
  browser,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Event Timing evidence is collected in Chromium');
  test.setTimeout(240_000);
  const webVitalsBundle = await build({
    bundle: true,
    format: 'iife',
    globalName: 'webVitals',
    platform: 'browser',
    stdin: {
      contents: "export { onINP } from 'web-vitals';",
      resolveDir: process.cwd(),
    },
    write: false,
  });
  const webVitalsSource = webVitalsBundle.outputFiles[0].text;
  const measurements: RunMeasurement[] = [];
  const artifactDirectory = resolve('test-results/interactions');
  await mkdir(artifactDirectory, { recursive: true });

  for (let run = 1; run <= 20; run += 1) {
    const context = await browser.newContext();
    await context.tracing.start({ screenshots: false, snapshots: true });
    const page = await context.newPage();
    const session = await context.newCDPSession(page);
    await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await session.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
      connectionType: 'cellular4g',
    });
    await page.addInitScript({
      content: `${webVitalsSource}
        window.__interactionEvidence = { inp: 0, eventDurations: [] };
        webVitals.onINP(function(metric) {
          window.__interactionEvidence.inp = metric.value;
        }, { reportAllChanges: true });
        new PerformanceObserver(function(list) {
          for (const entry of list.getEntries()) {
            if (entry.interactionId && entry.duration) {
              window.__interactionEvidence.eventDurations.push(entry.duration);
            }
          }
        }).observe({ type: 'event', buffered: true, durationThreshold: 0 });`,
    });
    await interceptOpenMeteo(page, {
      weatherDelayMs: 40,
      geocoding: 'ambiguous',
    });
    await page.goto('/');

    const feedback: Record<string, number> = {};
    const measure = async (
      name: string,
      action: () => Promise<void>,
      visible: () => Promise<void>,
    ) => {
      await page.evaluate((interactionName) => {
        const evidence = window as Window & {
          __feedbackDispatch?: number;
          __feedbackSeen?: number;
          __feedbackObserver?: MutationObserver;
        };
        evidence.__feedbackDispatch = 0;
        evidence.__feedbackSeen = 0;
        const acknowledgementIsVisible = () => {
          if (interactionName === 'search') {
            return [...document.querySelectorAll('button')].some(
              (button) => button.textContent?.trim() === 'Searching…',
            );
          }
          if (
            interactionName === 'candidate' ||
            interactionName === 'unit' ||
            interactionName === 'refresh'
          ) {
            return document.querySelector('.loading-state') !== null;
          }
          return [...document.querySelectorAll('button')].some(
            (button) => button.textContent?.trim() === 'Saved to favorites',
          );
        };
        evidence.__feedbackObserver = new MutationObserver(() => {
          if (!evidence.__feedbackSeen && acknowledgementIsVisible()) {
            evidence.__feedbackSeen = performance.now();
          }
        });
        evidence.__feedbackObserver.observe(document.body, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
        });
        document.addEventListener(
          'click',
          () => {
            evidence.__feedbackDispatch = performance.now();
          },
          { capture: true, once: true },
        );
      }, name);
      await action();
      await visible();
      feedback[name] = await page.evaluate(() => {
        const evidence = window as Window & {
          __feedbackDispatch?: number;
          __feedbackSeen?: number;
          __feedbackObserver?: MutationObserver;
        };
        evidence.__feedbackObserver?.disconnect();
        if (!evidence.__feedbackDispatch) {
          throw new Error('The interaction dispatch was not observed.');
        }
        if (!evidence.__feedbackSeen) {
          throw new Error('Visible acknowledgement was not observed.');
        }
        return evidence.__feedbackSeen - evidence.__feedbackDispatch;
      });
    };

    await page.getByLabel('City name').fill('Mumbai');
    await measure(
      'search',
      () => page.getByRole('button', { name: 'Search', exact: true }).click(),
      () => expect(page.getByText('2 matches found.')).toBeVisible(),
    );
    await measure(
      'candidate',
      () => page.getByRole('button', { name: /Mumbai Maharashtra India/ }).click(),
      () => expect(
        page.getByRole('region', { name: 'Current conditions' }).getByText(/30\s*°C/),
      ).toBeVisible(),
    );
    await measure(
      'unit',
      () => page.getByLabel('Fahrenheit').check(),
      () => expect(page.getByText(/86\s*°F/, { exact: true })).toBeVisible(),
    );
    await measure(
      'refresh',
      () => page.getByRole('button', { name: 'Refresh' }).click(),
      () => expect(page.getByRole('button', { name: 'Refresh' })).toBeEnabled(),
    );
    await expect(page.getByText(/86\s*°F/, { exact: true })).toBeVisible();
    await measure(
      'favorite',
      () => page.getByRole('button', { name: 'Add to favorites' }).click(),
      () => expect(page.getByRole('button', { name: 'Saved to favorites' })).toBeVisible(),
    );
    await page.waitForTimeout(100);
    const evidence = await page.evaluate(() => {
      const value = (window as unknown as Window & {
        __interactionEvidence: { inp: number; eventDurations: number[] };
      }).__interactionEvidence;
      return { inp: value.inp, eventDurations: value.eventDurations };
    });
    measurements.push({ run, feedback, ...evidence });
    await context.tracing.stop({
      path: resolve(artifactDirectory, `trace-${String(run).padStart(2, '0')}.zip`),
    });
    await context.close();
  }

  const artifact = resolve(artifactDirectory, 'raw.json');
  await writeFile(artifact, `${JSON.stringify(measurements, null, 2)}\n`, 'utf8');
  const validInp = measurements.map(({ inp }) => inp).filter((value) => value > 0);
  expect(validInp).toHaveLength(20);
  const sorted = [...validInp].sort((left, right) => left - right);
  const p75Inp = sorted[Math.ceil(sorted.length * 0.75) - 1];
  const feedbackValues = measurements.flatMap(({ feedback }) => Object.values(feedback));
  expect(p75Inp).toBeLessThanOrEqual(200);
  expect(Math.max(...feedbackValues)).toBeLessThanOrEqual(100);
});
