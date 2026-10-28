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
  await page.getByRole('button', { name: 'Configure AI' }).first().click();
  const dialog = page.locator('[data-nbinlineai-keys-dialog]');
  await dialog.getByRole('tab', { name: 'Connections & models' }).waitFor();
  const picker = dialog.locator('[data-nbinlineai-connection]');
  if (await picker.isVisible()) await picker.selectOption('anthropic_api');
  await dialog.locator('[data-nbinlineai-key-provider="anthropic_api"]').waitFor();
  await dialog.getByRole('tab', { name: 'Defaults' }).click();
  await dialog.locator('[data-nbinlineai-default-backend]').waitFor();
  const common = dialog.locator('[data-nbinlineai-common-instructions]');
  const commonEditor = common.getByRole('textbox', { name: 'Common response instructions' });
  await commonEditor.waitFor();
  const instructions = await commonEditor.inputValue();
  if (!instructions.includes('single dollar delimiters') || !instructions.includes('double dollar delimiters')) {
    throw new Error('Installed-wheel common instructions did not load the math default');
  }
  await common.locator('[data-nbinlineai-common-save]').scrollIntoViewIfNeeded();
  if (!await common.locator('[data-nbinlineai-common-save]').isVisible()) {
    throw new Error('Installed-wheel common instructions Save control is not visible');
  }
  if (promptRequests !== 0) throw new Error('Installed-wheel UI unexpectedly sent a prompt');
} finally {
  await browser.close();
}
