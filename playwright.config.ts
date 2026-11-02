import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // Keep Playwright's cleanup confined to its own evidence directory;
  // performance and deployment summaries under test-results must survive.
  outputDir: './test-results/playwright',
  testMatch: ['**/*.spec.ts'],
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
  },
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: process.env.INTERACTION_BUILD
          ? 'npm run preview -- --host 127.0.0.1 --port 4173'
          : 'npm run dev -- --host 127.0.0.1 --port 4173',
        url: 'http://127.0.0.1:4173',
        reuseExistingServer: !process.env.CI && !process.env.INTERACTION_BUILD,
      },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
