import { expect, test } from '@playwright/test';

test('Configure AI recovers after a temporary settings 404 and keeps a successful save visible', async ({ page, request }) => {
  await page.route('**/nbinlineai/settings/keys', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 404, body: 'Not Found' });
    } else {
      await route.continue();
    }
  });
  await request.get('/lab');
  const xsrf = (await request.storageState()).cookies.find(cookie => cookie.name === '_xsrf')?.value;
  expect(xsrf).toBeTruthy();
  const name = `settings-recovery-${Date.now()}.ipynb`;
  const created = await request.put(`/api/contents/${name}`, {
    headers: { 'X-XSRFToken': xsrf! },
    data: {
      type: 'notebook', format: 'json', content: {
        cells: [{ id: 'setup', cell_type: 'code', source: 'pass', metadata: {}, outputs: [], execution_count: null }],
        metadata: { kernelspec: { display_name: 'Python 3 (ipykernel)', language: 'python', name: 'python3' } },
        nbformat: 4, nbformat_minor: 5
      }
    }
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  await page.goto(`/lab/workspaces/${name.slice(0, -6)}/tree/${name}`);
  await expect(page.locator('.jp-NotebookPanel:visible')).toBeVisible();
  await page.getByRole('button', { name: 'Configure AI' }).click();
  const dialog = page.locator('[data-nbinlineai-keys-dialog]');
  const openai = dialog.locator('[data-nbinlineai-key-provider="openai_api"]');
  const input = openai.locator('[data-nbinlineai-key-input]');
  const save = openai.locator('[data-nbinlineai-key-save]');
  await expect(dialog).toContainText(/restart|server|retry/i);
  await input.fill('e2e-fake-404-recovery');
  await expect(save).toBeDisabled();

  await page.unroute('**/nbinlineai/settings/keys');
  await dialog.locator('[data-nbinlineai-key-retry]').click();
  await expect(openai.locator('[data-nbinlineai-key-status]')).toContainText(/Not configured|Saved/);
  await expect(save).toBeEnabled();

  await page.route('**/nbinlineai/status', async route => {
    await route.fulfill({ status: 404, body: 'Not Found' });
  });
  const saved = page.waitForResponse(response => response.url().endsWith('/nbinlineai/settings/keys') && response.request().method() === 'POST');
  await save.click();
  expect((await saved).ok()).toBeTruthy();
  await expect(openai.locator('[data-nbinlineai-key-status]')).toContainText('Saved');
  await expect(dialog).toContainText(/saved/i);
  await expect(input).toBeEmpty();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-CodeCell').first().click();
  await page.getByRole('button', { name: 'AI Prompt' }).click();
  const prompt = page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-Cell.nbinlineai-prompt-cell');
  const provider = prompt.locator('select[data-nbinlineai-provider]');
  await expect(provider).toHaveValue('');
  await expect(provider.locator('option').first()).toContainText('Notebook default (OpenAI)');
  await expect(prompt.locator('button[data-nbinlineai-run]')).toBeEnabled();
  await page.unroute('**/nbinlineai/status');

  const removed = await request.delete('/nbinlineai/settings/keys/openai_api', { headers: { 'X-XSRFToken': xsrf! } });
  expect(removed.ok(), await removed.text()).toBeTruthy();
});
