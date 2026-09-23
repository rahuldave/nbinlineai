import { expect, test } from '@playwright/test';

test('Keep answer blocks a completed rerun, then an explicit opt-out uses current defaults after reload', async ({ page, request }) => {
  await request.get('/lab');
  const xsrf = (await request.storageState()).cookies.find(cookie => cookie.name === '_xsrf')?.value;
  expect(xsrf).toBeTruthy();
  const headers = { 'X-XSRFToken': xsrf! };
  for (const backend of ['openai_api', 'anthropic_api']) {
    const saved = await request.post('/nbinlineai/settings/keys', { headers, data: { backend, key: `e2e-no-network-${backend}` } });
    expect(saved.ok(), await saved.text()).toBeTruthy();
  }
  const name = `keep-answer-${Date.now()}-${Math.floor(Math.random() * 1e6)}.ipynb`;
  const created = await request.put(`/api/contents/${name}`, { headers, data: {
    type: 'notebook', format: 'json', content: {
      cells: [
        { id: 'first', cell_type: 'code', source: 'value = 2', metadata: {}, outputs: [], execution_count: null },
        { id: 'second', cell_type: 'code', source: 'print(value)', metadata: {}, outputs: [], execution_count: null }
      ],
      metadata: { kernelspec: { display_name: 'Python 3 (ipykernel)', language: 'python', name: 'python3' } },
      nbformat: 4, nbformat_minor: 5
    }
  } });
  expect(created.ok(), await created.text()).toBeTruthy();
  await page.goto(`/lab/workspaces/${name.slice(0, -6)}/tree/${name}`);
  const panel = page.locator('.jp-NotebookPanel:visible');
  const notebook = panel.locator('.jp-Notebook');
  await expect(notebook.locator('.jp-CodeCell')).toHaveCount(2);
  await expect.poll(async () => {
    const sessions = await request.get('/api/sessions');
    if (!sessions.ok()) return false;
    return (await sessions.json()).some((session: any) => session.path === name && session.kernel?.id);
  }).toBeTruthy();
  await notebook.locator('.jp-CodeCell').first().click();
  await page.getByRole('button', { name: 'AI Prompt' }).click();
  const prompt = notebook.locator('.jp-Cell.nbinlineai-prompt-cell');
  const run = prompt.locator('[data-nbinlineai-run]');
  const keep = prompt.locator('[data-nbinlineai-keep-answer]');
  await prompt.locator('.cm-content').fill('E2E_BASIC first answer');
  await expect(keep).toBeChecked();
  await run.click();
  await expect(prompt.locator('.nbinlineai-status')).toContainText('Answer kept');
  await expect(run).toBeDisabled();
  await expect(run).toHaveAttribute('title', /Uncheck Keep answer/);
  await expect(notebook.locator('.nbinlineai-response-cell')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/nbinlineai-014-keep-answer.png', fullPage: true });

  await prompt.click();
  await expect(prompt).toHaveClass(/jp-mod-active/);
  await page.keyboard.press('Shift+Enter');
  await expect(prompt).not.toHaveClass(/jp-mod-active/);
  const unexpected = await page.waitForRequest(item => item.url().endsWith('/nbinlineai/prompt') && item.method() === 'POST', { timeout: 500 })
    .then(() => true, () => false);
  expect(unexpected).toBe(false);
  await expect(notebook.locator('.nbinlineai-response-cell')).toHaveCount(1);

  const row = panel.locator('[data-nbinlineai-notebook-defaults]');
  await row.locator('[data-nbinlineai-notebook-provider]').selectOption('openai_api');
  await row.locator('[data-nbinlineai-notebook-model-select]').selectOption('gpt-6-luna');
  await row.locator('[data-nbinlineai-notebook-prompt-mode]').selectOption('full');
  await row.locator('[data-nbinlineai-notebook-effort]').selectOption('high');
  await expect(run).toBeDisabled();
  await keep.uncheck();
  await expect(run).toBeEnabled();
  const posted = page.waitForRequest(item => item.url().endsWith('/nbinlineai/prompt') && item.method() === 'POST');
  await run.click();
  const body = (await posted).postDataJSON();
  expect(body).toMatchObject({ backend: 'openai_api', model: 'gpt-6-luna', prompt_mode: 'full', reasoning_effort: 'high' });
  await expect(prompt.locator('.nbinlineai-status')).toContainText(/Done|Answer kept/);
  await expect(notebook.locator('.nbinlineai-response-cell')).toHaveCount(1);
  await page.keyboard.press('Meta+s');
  await expect(page.getByText('Saving completed')).toBeVisible();
  const saved = await request.get(`/api/contents/${name}?content=1`);
  const content = (await saved.json()).content;
  const meta = content.cells.find((cell: any) => cell.metadata?.nbinlineai?.isPromptCell).metadata.nbinlineai;
  expect(meta.keepAnswer).toBe(false);
  expect(meta.backend).toBeUndefined();
  expect(meta.model).toBeUndefined();
  await page.reload();
  await expect(keep).not.toBeChecked();
  await expect(run).toBeEnabled();
  await keep.check();
  await expect(run).toBeDisabled();
});
