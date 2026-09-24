// Browser-only check of the installed wheel. It never sends a prompt request.
import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  let promptRequests = 0;
  await page.route('**/nbinlineai/prompt', route => {
    promptRequests += 1;
    return route.abort();
  });
  await page.goto('http://127.0.0.1:8897/lab/tree/quickstart.ipynb');
  await page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-Cell').first()
    .waitFor({ timeout: 60000 });
  await page.getByRole('button', { name: 'AI Prompt' }).first()
    .waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: 'Configure AI' }).first()
    .waitFor({ timeout: 30000 });
  if (promptRequests !== 0) throw new Error('Installed-wheel UI unexpectedly sent a prompt');
} finally {
  await browser.close();
}
