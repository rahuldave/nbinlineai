import { expect, test } from '../support/e2e-fixtures';

test('provider controls follow key availability and preserve an explicit unavailable choice', async ({ page, request }) => {
  await request.get('/lab');
  const xsrf = (await request.storageState()).cookies.find(cookie => cookie.name === '_xsrf')?.value;
  expect(xsrf).toBeTruthy();
  const headers = { 'X-XSRFToken': xsrf! };
  for (const backend of ['openai_api', 'anthropic_api']) {
    const response = await request.delete(`/nbinlineai/settings/keys/${backend}`, { headers });
    expect(response.ok(), await response.text()).toBeTruthy();
  }
  const name = `availability-${Date.now()}.ipynb`;
  const created = await request.put(`/api/contents/${name}`, {
    headers,
    data: {
      type: 'notebook', format: 'json', content: {
        cells: [
          { id: 'first', cell_type: 'code', source: 'x = 1', metadata: {}, outputs: [], execution_count: null },
          { id: 'second', cell_type: 'code', source: 'y = 2', metadata: {}, outputs: [], execution_count: null }
        ],
        metadata: { kernelspec: { display_name: 'Python 3 (ipykernel)', language: 'python', name: 'python3' } },
        nbformat: 4, nbformat_minor: 5
      }
    }
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  await page.goto(`/lab/workspaces/${name.slice(0, -6)}/tree/${name}`);
  const notebook = page.locator('.jp-NotebookPanel:visible .jp-Notebook');
  await expect(notebook.locator('.jp-CodeCell')).toHaveCount(2);
  await notebook.locator('.jp-CodeCell').first().click();
  await page.getByRole('button', { name: 'AI Prompt' }).click();
  const firstPrompt = notebook.locator('.jp-Cell.nbinlineai-prompt-cell').first();
  await expect(firstPrompt.locator('button[data-nbinlineai-run]')).toBeDisabled();
  await expect(firstPrompt.locator('.nbinlineai-status')).toContainText('Configure AI');

  await page.getByRole('button', { name: 'Configure AI' }).first().click();
  const dialog = page.locator('[data-nbinlineai-keys-dialog]');
  const connection = dialog.locator('[data-nbinlineai-connection]');
  const anthropicRow = dialog.locator('[data-nbinlineai-key-provider="anthropic_api"]');
  const openaiRow = dialog.locator('[data-nbinlineai-key-provider="openai_api"]');
  await connection.selectOption('anthropic_api');
  await anthropicRow.locator('[data-nbinlineai-key-input]').fill('e2e-no-network-anthropic');
  await anthropicRow.locator('[data-nbinlineai-key-save]').click();
  await expect(anthropicRow.locator('[data-nbinlineai-key-status]')).toContainText('Saved');
  await page.getByRole('button', { name: 'Done' }).click();

  await notebook.locator('.jp-CodeCell').last().click();
  await page.getByRole('button', { name: 'AI Prompt' }).click();
  const prompt = notebook.locator('.jp-Cell.nbinlineai-prompt-cell').last();
  await prompt.locator('[data-nbinlineai-override]').click();
  const provider = prompt.locator('select[data-nbinlineai-provider]');
  const model = prompt.locator('select[data-nbinlineai-model-select]');
  const run = prompt.locator('button[data-nbinlineai-run]');
  await expect(provider).toHaveValue('');
  await expect(provider.locator('option').first()).toContainText('Notebook default (Anthropic)');
  await expect(provider.locator('option[value="openai_api"]')).toBeDisabled();
  await expect(provider.locator('option[value="openai_api"]')).toContainText('API key required');
  await expect(model.locator('option')).toContainText([
    'Notebook default model (claude-sonnet-5)', 'claude-sonnet-5', 'claude-haiku-4-5-20251001', 'claude-opus-5-5', 'claude-fable-5-1', 'Custom model…'
  ]);
  await expect(run).toBeEnabled();
  await model.selectOption('claude-haiku-4-5-20251001');

  await page.getByRole('button', { name: 'Configure AI' }).first().click();
  await connection.selectOption('openai_api');
  await openaiRow.locator('[data-nbinlineai-key-input]').fill('e2e-no-network-openai');
  await openaiRow.locator('[data-nbinlineai-key-save]').click();
  await expect(openaiRow.locator('[data-nbinlineai-key-status]')).toContainText('Saved');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(provider.locator('option[value="openai_api"]')).toBeEnabled();
  await expect(provider).toHaveValue('');
  await expect(model).toHaveValue('claude-haiku-4-5-20251001');
  await provider.selectOption('openai_api');
  await model.selectOption('gpt-6-luna');
  await expect(run).toBeEnabled();

  await page.getByRole('button', { name: 'Configure AI' }).first().click();
  await connection.selectOption('openai_api');
  await openaiRow.locator('[data-nbinlineai-key-remove]').click();
  await expect(openaiRow.locator('[data-nbinlineai-key-status]')).toContainText('Not configured');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(provider).toHaveValue('openai_api');
  await expect(provider.locator('option[value="openai_api"]')).toBeDisabled();
  await expect(model).toBeDisabled();
  await expect(run).toBeDisabled();
  await expect(prompt.locator('.nbinlineai-status')).toContainText('API key required');
  await provider.selectOption('anthropic_api');
  await expect(run).toBeEnabled();
  await prompt.locator('.cm-content').fill('E2E_BASIC completed before key removal');
  await run.click();
  await expect(prompt.locator('.nbinlineai-status')).toContainText(/Done|Answer kept/);

  await page.getByRole('button', { name: 'Configure AI' }).first().click();
  await connection.selectOption('anthropic_api');
  await anthropicRow.locator('[data-nbinlineai-key-remove]').click();
  await expect(anthropicRow.locator('[data-nbinlineai-key-status]')).toContainText('Not configured');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(run).toBeDisabled();
  await expect(prompt.locator('.nbinlineai-status')).toContainText('Configure AI');
  await expect(prompt.locator('.nbinlineai-status')).not.toContainText('Done');
});
