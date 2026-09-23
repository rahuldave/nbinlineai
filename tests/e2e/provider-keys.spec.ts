import { expect, test } from '@playwright/test';

test('Configure AI saves, replaces, reopens, and removes provider keys without notebook leakage', async ({ page, request }) => {
  await request.get('/lab');
  const xsrf = (await request.storageState()).cookies.find(cookie => cookie.name === '_xsrf')?.value;
  expect(xsrf).toBeTruthy();
  const headers = { 'X-XSRFToken': xsrf! };
  for (const backend of ['openai_api', 'anthropic_api']) {
    const removed = await request.delete(`/nbinlineai/settings/keys/${backend}`, { headers });
    expect(removed.ok(), await removed.text()).toBeTruthy();
  }

  const name = `keys-e2e-${Date.now()}.ipynb`;
  const created = await request.put(`/api/contents/${name}`, {
    headers,
    data: {
      type: 'notebook', format: 'json', content: {
        cells: [{ id: 'keys-setup', cell_type: 'code', source: 'answer = 42', metadata: {}, outputs: [], execution_count: null }],
        metadata: { kernelspec: { display_name: 'Python 3 (ipykernel)', language: 'python', name: 'python3' } },
        nbformat: 4, nbformat_minor: 5
      }
    }
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  await page.goto(`/lab/workspaces/${name.slice(0, -6)}/tree/${name}`);
  await expect(page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-CodeCell')).toHaveCount(1);
  await page.getByRole('button', { name: 'Configure AI' }).first().click();
  const dialog = page.locator('[data-nbinlineai-keys-dialog]');
  const openai = dialog.locator('[data-nbinlineai-key-provider="openai_api"]');
  const anthropic = dialog.locator('[data-nbinlineai-key-provider="anthropic_api"]');
  await expect(openai.locator('[data-nbinlineai-key-status]')).toContainText('Not configured');
  await expect(anthropic.locator('[data-nbinlineai-key-status]')).toContainText('Not configured');
  await expect(openai.locator('[data-nbinlineai-key-input]')).toHaveAttribute('type', 'password');

  const firstKey = 'e2e-fake-openai-first';
  const replacementKey = 'e2e-fake-openai-replacement';
  const anthropicKey = 'e2e-fake-anthropic';
  for (const key of [firstKey, replacementKey]) {
    await openai.locator('[data-nbinlineai-key-input]').fill(key);
    const saved = page.waitForResponse(response => response.url().endsWith('/nbinlineai/settings/keys') && response.request().method() === 'POST');
    await openai.locator('[data-nbinlineai-key-save]').click();
    const response = await saved;
    expect(response.ok()).toBeTruthy();
    expect(JSON.stringify(await response.json())).not.toContain(key);
    await expect(openai.locator('[data-nbinlineai-key-status]')).toContainText('Saved');
    await expect(openai.locator('[data-nbinlineai-key-input]')).toBeEmpty();
  }
  await anthropic.locator('[data-nbinlineai-key-input]').fill(anthropicKey);
  await anthropic.locator('[data-nbinlineai-key-save]').click();
  await expect(anthropic.locator('[data-nbinlineai-key-status]')).toContainText('Saved');
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Configure AI' }).first().click();
  await expect(dialog.locator('[data-nbinlineai-key-status="openai_api"]')).toContainText('Saved');
  await expect(dialog.locator('[data-nbinlineai-key-status="anthropic_api"]')).toContainText('Saved');
  await expect(dialog.locator('[data-nbinlineai-key-input="openai_api"]')).toBeEmpty();
  await expect(dialog.locator('[data-nbinlineai-key-input="anthropic_api"]')).toBeEmpty();

  const status = await request.get('/nbinlineai/settings/keys');
  expect(status.ok()).toBeTruthy();
  const statusText = await status.text();
  for (const key of [firstKey, replacementKey, anthropicKey]) expect(statusText).not.toContain(key);
  expect(JSON.parse(statusText).providers.openai_api.source).toBe('saved');
  expect(JSON.parse(statusText).providers.anthropic_api.source).toBe('saved');
  const publicStatus = await request.get('/nbinlineai/status');
  expect(publicStatus.ok()).toBeTruthy();
  const publicStatusText = await publicStatus.text();
  for (const key of [firstKey, replacementKey, anthropicKey]) expect(publicStatusText).not.toContain(key);

  await openai.locator('[data-nbinlineai-key-remove]').click();
  await expect(openai.locator('[data-nbinlineai-key-status]')).toContainText('Not configured');
  await expect(anthropic.locator('[data-nbinlineai-key-status]')).toContainText('Saved');
  await anthropic.locator('[data-nbinlineai-key-remove]').click();
  await expect(anthropic.locator('[data-nbinlineai-key-status]')).toContainText('Not configured');
  await page.getByRole('button', { name: 'Done' }).click();

  const cell = page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-CodeCell').first();
  await cell.click();
  await page.getByRole('button', { name: 'AI Prompt' }).click();
  const prompt = page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-Cell.nbinlineai-prompt-cell');
  await prompt.locator('.cm-content').fill('Explain answer');
  let promptPosts = 0;
  page.on('request', item => { if (item.url().endsWith('/nbinlineai/prompt') && item.method() === 'POST') promptPosts++; });
  await expect(prompt.locator('button[data-nbinlineai-run]')).toBeDisabled();
  await expect(prompt.locator('.nbinlineai-status')).toContainText('Configure AI');
  expect(promptPosts).toBe(0);
  await page.keyboard.press('Meta+s');
  await expect(page.getByText('Saving completed')).toBeVisible();
  let notebookText = '';
  await expect.poll(async () => {
    const notebook = await request.get(`/api/contents/${name}?content=1`);
    if (!notebook.ok()) return false;
    notebookText = await notebook.text();
    return notebookText.includes('Explain answer');
  }).toBeTruthy();
  for (const key of [firstKey, replacementKey, anthropicKey]) expect(notebookText).not.toContain(key);
});
