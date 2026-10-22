import { defineConfig, devices } from '@playwright/test';

/**
 * E2E tests run against a real API + Postgres (seeded with demo data) and the built web app.
 * Start them yourself (see README.md) or let Playwright start them.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.WEB_URL ?? 'http://localhost:3000',
    locale: 'ar',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
    viewport: { width: 1366, height: 1024 }, // landscape tablet
    // CI/cloud images may ship a different Chromium build than this Playwright version expects.
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  webServer: [
    {
      command: 'node apps/api/dist/main.js',
      url: 'http://localhost:4000/health',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @mdarai/web start',
      url: 'http://localhost:3000/kiosk',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
