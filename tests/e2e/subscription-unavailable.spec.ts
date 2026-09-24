import { expect, test } from '@playwright/test';

test('saved unavailable ChatGPT choice survives a model edit without choosing an API', async ({ page, request }) => {
  await request.get('/lab');
  const xsrf = (await request.storageState()).cookies.find(cookie => cookie.name === '_xsrf')?.value;
  expect(xsrf).toBeTruthy();
  const headers = { 'X-XSRFToken': xsrf! };
  for (const backend of ['openai_api', 'anthropic_api']) {
    const response = await request.post('/nbinlineai/settings/keys', {
      headers, data: { backend, key: `e2e-no-network-${backend}` }
    });
    expect(response.ok(), await response.text()).toBeTruthy();
  }

  const name = `subscription-unavailable-${Date.now()}.ipynb`;
  const created = await request.put(`/api/contents/${name}`, {
    headers,
    data: { type: 'notebook', format: 'json', content: {
      cells: [
        { id: 'setup', cell_type: 'code', source: 'value = 1', metadata: {}, outputs: [], execution_count: null },
        { id: 'question', cell_type: 'markdown', source: 'Explain value',
          metadata: { nbinlineai: { isPromptCell: true, backend: 'openai_codex_subscription', model: 'gpt-6-sol' } } }
      ],
      metadata: {
        kernelspec: { display_name: 'Python 3 (ipykernel)', language: 'python', name: 'python3' },
        nbinlineai: { defaults: { backend: 'openai_codex_subscription', model: 'gpt-6-sol' }, defaultsInitialized: true }
      },
      nbformat: 4, nbformat_minor: 5
    } }
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  await page.goto(`/lab/workspaces/${name.slice(0, -6)}/tree/${name}`);
  const panel = page.locator('.jp-NotebookPanel:visible');
  const prompt = panel.locator('.jp-Cell.nbinlineai-prompt-cell');
  await expect(prompt).toBeVisible();
  // Kernel startup may add Jupyter-owned metadata. Save that baseline, then
  // verify a fresh open and status refresh leave every AI metadata field alone.
  await page.keyboard.press('Meta+s');
  await expect(page.getByText('Saving completed')).toBeVisible();
  const beforeReloadResponse = await request.get(`/api/contents/${name}?content=1`);
  expect(beforeReloadResponse.ok()).toBeTruthy();
  const beforeReload = (await beforeReloadResponse.json()).content;
  expect(beforeReload.metadata.nbinlineai).toEqual({
    defaults: { backend: 'openai_codex_subscription', model: 'gpt-6-sol' }, defaultsInitialized: true
  });
  expect(beforeReload.cells.find((cell: any) => cell.id === 'question')?.metadata?.nbinlineai).toEqual({
    isPromptCell: true, backend: 'openai_codex_subscription', model: 'gpt-6-sol'
  });
  await page.reload();
  await expect(prompt).toBeVisible();
  await page.keyboard.press('Meta+s');
  await expect(page.getByText('Saving completed')).toBeVisible();
  const baselineResponse = await request.get(`/api/contents/${name}?content=1`);
  expect(baselineResponse.ok()).toBeTruthy();
  const baseline = (await baselineResponse.json()).content;
  expect(baseline.metadata.nbinlineai).toEqual(beforeReload.metadata.nbinlineai);
  expect(baseline.cells.map((cell: any) => cell.metadata?.nbinlineai)).toEqual(
    beforeReload.cells.map((cell: any) => cell.metadata?.nbinlineai)
  );
  await expect(page.locator('.lm-TabBar-tab.jp-mod-dirty')).toHaveCount(0);

  await page.getByRole('button', { name: 'Configure AI' }).first().click();
  const dialog = page.locator('[data-nbinlineai-keys-dialog]');
  await expect(dialog.locator('[data-nbinlineai-connection]')).toBeHidden();
  await expect(dialog.locator('[data-nbinlineai-subscription-setup]')).toBeHidden();
  await expect(dialog.locator('[data-nbinlineai-key-provider="openai_api"]')).toBeVisible();
  await expect(dialog.locator('[data-nbinlineai-key-provider="anthropic_api"]')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.lm-TabBar-tab.jp-mod-dirty')).toHaveCount(0);

  const notebookProvider = panel.locator('[data-nbinlineai-notebook-provider]');
  await expect(notebookProvider).toHaveValue('openai_codex_subscription');
  await expect(notebookProvider.locator('option[value="openai_codex_subscription"]')).toBeDisabled();
  await expect(notebookProvider.locator('option[value="openai_codex_subscription"]')).toContainText('ChatGPT subscription unavailable');

  await prompt.locator('[data-nbinlineai-override]').click();
  const provider = prompt.locator('[data-nbinlineai-provider]');
  const model = prompt.locator('[data-nbinlineai-model]');
  await expect(provider).toHaveValue('openai_codex_subscription');
  await expect(provider.locator('option[value="openai_codex_subscription"]')).toBeDisabled();
  await expect(model).toBeVisible();
  await expect(model).toBeEnabled();
  await expect(prompt.locator('[data-nbinlineai-run]')).toBeDisabled();
  await expect(prompt.locator('.nbinlineai-status')).toContainText('ChatGPT subscription unavailable');
  await expect(prompt.locator('.nbinlineai-status')).not.toContainText('API key required');

  await model.fill('gpt-6-luna');
  await expect(provider).toHaveValue('openai_codex_subscription');
  await expect(prompt.locator('[data-nbinlineai-run]')).toBeDisabled();
  await page.keyboard.press('Meta+s');
  await expect.poll(async () => {
    const saved = await request.get(`/api/contents/${name}?content=1`);
    if (!saved.ok()) return null;
    const content = (await saved.json()).content;
    return content.cells.find((cell: any) => cell.id === 'question')?.metadata?.nbinlineai;
  }).toMatchObject({ backend: 'openai_codex_subscription', model: 'gpt-6-luna' });
});
