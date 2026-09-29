import { defineConfig, devices } from '@playwright/test';

import baseConfig from './playwright.config';

// Select one project per invocation so each engine owns its server lifecycle.
export default defineConfig({
  ...baseConfig,
  testMatch: '**/browser-media-*.spec.ts',
  workers: 1,
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } }
  ]
});
