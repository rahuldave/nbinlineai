import { expect, test } from '@playwright/test';

test('model picker sends defaults, listed choices, and a persisted custom ID', async ({ page, request }) => {
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
  const statusResponse = await request.get('/nbinlineai/status');
  expect(statusResponse.ok()).toBeTruthy();
  const status = await statusResponse.json();
  expect(status.providers.openai_api.default_model).toBe('gpt-6-sol');
  expect(status.providers.openai_api.models).toEqual(['gpt-6-sol', 'gpt-6-luna', 'gpt-6-astra']);
  expect(status.providers.anthropic_api.default_model).toBe('claude-sonnet-5');
  expect(status.providers.anthropic_api.models).toEqual([
    'claude-sonnet-5', 'claude-haiku-4-5-20251001', 'claude-opus-5-5', 'claude-fable-5-1'
  ]);

  const name = `model-choice-${Date.now()}.ipynb`;
  const created = await request.put(`/api/contents/${name}`, {
    headers,
    data: {
      type: 'notebook', format: 'json', content: {
        cells: [{ id: 'setup', cell_type: 'code', source: 'value = 5', metadata: {}, outputs: [], execution_count: null }],
        metadata: { kernelspec: { display_name: 'Python 3 (ipykernel)', language: 'python', name: 'python3' } },
        nbformat: 4, nbformat_minor: 5
      }
    }
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  await page.goto(`/lab/workspaces/${name.slice(0, -6)}/tree/${name}`);
  await expect(page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-CodeCell')).toHaveCount(1);
  await page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-CodeCell').click();
  await page.getByRole('button', { name: 'AI Prompt' }).click();
  const prompt = page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-Cell.nbinlineai-prompt-cell');
  await prompt.locator('.cm-content').fill('E2E_BASIC model selection');
  const provider = prompt.locator('select[data-nbinlineai-provider]');
  const select = prompt.locator('select[data-nbinlineai-model-select]');
  const custom = prompt.locator('input[data-nbinlineai-model]');
  const answer = page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-Cell.nbinlineai-response-cell');
  await expect(select).toHaveValue('__nbinlineai_default__');
  await expect(select.locator('option')).toContainText(['Default', 'gpt-6-sol', 'gpt-6-luna', 'gpt-6-astra', 'Custom model']);
  await expect(custom).toBeHidden();
  await page.screenshot({ path: 'test-results/nbinlineai-model-picker.png', fullPage: true });

  let sent = page.waitForRequest(item => item.url().endsWith('/nbinlineai/prompt') && item.method() === 'POST');
  await prompt.locator('button[data-nbinlineai-run]').click();
  expect([undefined, 'gpt-6-sol']).toContain((await sent).postDataJSON().model);
  await expect(answer).toContainText('model=gpt-6-sol');

  await select.selectOption('gpt-6-luna');
  sent = page.waitForRequest(item => item.url().endsWith('/nbinlineai/prompt') && item.method() === 'POST');
  await prompt.locator('button[data-nbinlineai-run]').click();
  expect((await sent).postDataJSON().model).toBe('gpt-6-luna');
  await expect(answer).toContainText('model=gpt-6-luna');

  await select.selectOption('__nbinlineai_custom__');
  await expect(custom).toBeVisible();
  await custom.fill('student-custom-model');
  await custom.press('Tab');
  sent = page.waitForRequest(item => item.url().endsWith('/nbinlineai/prompt') && item.method() === 'POST');
  await prompt.locator('button[data-nbinlineai-run]').click();
  expect((await sent).postDataJSON().model).toBe('student-custom-model');
  await expect(answer).toContainText('model=student-custom-model');
  await page.keyboard.press('Meta+s');
  await expect.poll(async () => {
    const saved = await request.get(`/api/contents/${name}?content=1`);
    if (!saved.ok()) return null;
    const body = await saved.json();
    return body.content.cells.find((cell: any) => cell.metadata?.nbinlineai?.isPromptCell)?.metadata?.nbinlineai?.model;
  }).toBe('student-custom-model');
  await page.reload();
  await expect(select).toHaveValue('__nbinlineai_custom__');
  await expect(custom).toHaveValue('student-custom-model');

  await provider.selectOption('anthropic_api');
  await expect(select).toHaveValue('__nbinlineai_default__');
  await expect(custom).toBeHidden();
  await expect(select.locator('option')).toContainText([
    'Default', 'claude-sonnet-5', 'claude-haiku-4-5-20251001', 'claude-opus-5-5', 'claude-fable-5-1', 'Custom model'
  ]);
  await select.selectOption('claude-haiku-4-5-20251001');
  sent = page.waitForRequest(item => item.url().endsWith('/nbinlineai/prompt') && item.method() === 'POST');
  await prompt.locator('button[data-nbinlineai-run]').click();
  const body = (await sent).postDataJSON();
  expect(body.backend).toBe('anthropic_api');
  expect(body.model).toBe('claude-haiku-4-5-20251001');
  await expect(answer).toContainText('model=claude-haiku-4-5-20251001');
});
