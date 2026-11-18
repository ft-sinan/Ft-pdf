import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/browser',
  timeout: 45000,
  retries: 0,
  workers: 2,
  use: {
    baseURL: 'http://127.0.0.1:4174',
    viewport: { width: 1366, height: 900 },
    screenshot: 'only-on-failure',
    launchOptions: process.env.FT_CHROMIUM
      ? {
          executablePath: process.env.FT_CHROMIUM,
          args: ['--no-sandbox', '--no-zygote', '--disable-dev-shm-usage', '--disable-gpu'],
        }
      : {},
  },
  webServer: {
    command: 'node server/index.mjs --port 4174',
    env: { FT_DB: ':memory:' },
    url: 'http://127.0.0.1:4174',
    timeout: 60000,
    reuseExistingServer: false,
  },
});
