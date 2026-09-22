import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.NBINLINEAI_E2E_PORT ?? '8897');
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: process.env.NBINLINEAI_E2E_LIVE === '1' ? 'prompt.spec.ts' : 'live-provider.spec.ts',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: '.venv/bin/python tests/support/e2e_server.py',
    url: `${baseURL}/lab`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { NBINLINEAI_E2E_PORT: String(port) }
  }
});
