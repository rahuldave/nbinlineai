import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

const notebook = (page: Page) => page.locator('.jp-NotebookPanel:visible .jp-Notebook');
const defaults = (page: Page) => page.locator('.jp-NotebookPanel:visible [data-nbinlineai-notebook-defaults]');
const prompts = (page: Page) => notebook(page).locator('.jp-Cell.nbinlineai-prompt-cell');

test.beforeEach(async ({ request }) => {
  await request.get('/lab');
  const xsrf = (await request.storageState()).cookies.find(cookie => cookie.name === '_xsrf')?.value;
  expect(xsrf).toBeTruthy();
  for (const backend of ['openai_api', 'anthropic_api']) {
    const response = await request.post('/nbinlineai/settings/keys', {
      headers: { 'X-XSRFToken': xsrf! },
      data: { backend, key: `e2e-no-network-${backend}` }
    });
    expect(response.ok(), await response.text()).toBeTruthy();
  }
});

async function openNotebook(page: Page, request: APIRequestContext) {
  const name = `defaults-${Date.now()}-${Math.floor(Math.random() * 1e6)}.ipynb`;
  const xsrf = (await request.storageState()).cookies.find(cookie => cookie.name === '_xsrf')?.value;
  expect(xsrf).toBeTruthy();
  const created = await request.put(`/api/contents/${name}`, {
    headers: { 'X-XSRFToken': xsrf! },
    data: { type: 'notebook', format: 'json', content: {
      cells: [{ id: 'setup', cell_type: 'code', source: 'value = 2', metadata: {}, outputs: [], execution_count: null }],
      metadata: { kernelspec: { display_name: 'Python 3 (ipykernel)', language: 'python', name: 'python3' } },
      nbformat: 4, nbformat_minor: 5
    } }
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  await page.goto(`/lab/workspaces/${name.slice(0, -6)}/tree/${name}`);
  await expect(notebook(page).locator('.jp-CodeCell')).toHaveCount(1);
  await expect(defaults(page)).toBeVisible();
  await expect.poll(async () => {
    const row = await defaults(page).boundingBox();
    const select = await defaults(page).locator('[data-nbinlineai-notebook-provider]').boundingBox();
    return !!row && !!select && row.height >= select.height + 6
      && select.y >= row.y && select.y + select.height <= row.y + row.height + 1;
  }).toBe(true);
  await expect.poll(async () => {
    const response = await request.get('/api/sessions');
    if (!response.ok()) return false;
    return (await response.json()).some((session: any) => session.path === name && session.kernel?.id);
  }).toBeTruthy();
  return name;
}

async function addPrompt(page: Page, source: string) {
  await notebook(page).locator('.jp-Cell').last().click();
  await page.getByRole('button', { name: 'AI Prompt' }).click();
  const prompt = prompts(page).last();
  await expect(prompt).toBeVisible();
  await prompt.locator('.cm-content').fill(source);
  return prompt;
}

async function postRun(page: Page, prompt: Locator) {
  const run = prompt.locator('[data-nbinlineai-run]');
  if (await run.isDisabled()) {
    await prompt.locator('[data-nbinlineai-keep-answer]').uncheck();
    await expect(run).toBeEnabled();
  }
  const posted = page.waitForRequest(item => item.url().endsWith('/nbinlineai/prompt') && item.method() === 'POST');
  await run.click();
  const body = (await posted).postDataJSON();
  await expect(prompt.locator('.nbinlineai-status')).toContainText(/Done|Answer kept/);
  return body;
}

async function savedNotebook(request: APIRequestContext, name: string) {
  const saved = await request.get(`/api/contents/${name}?content=1`);
  expect(saved.ok(), await saved.text()).toBeTruthy();
  return (await saved.json()).content;
}

async function saveNotebook(page: Page) {
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.getByText('Saving completed')).toBeVisible();
}

async function expandCompactTemplate(dialog: Locator) {
  const details = dialog.locator('[data-nbinlineai-template-details]');
  if ((await details.getAttribute('open')) === null) await details.locator(':scope > summary').click();
  const compact = details.locator('[data-nbinlineai-template-mode="compact"]');
  if ((await compact.getAttribute('open')) === null) await compact.locator(':scope > summary').click();
}

test('opening an ordinary notebook leaves AI metadata alone; first AI insert snapshots a model', async ({ page, request }) => {
  const name = await openNotebook(page, request);
  let saved = await savedNotebook(request, name);
  expect(saved.metadata.nbinlineai).toBeUndefined();
  const prompt = await addPrompt(page, 'E2E_BASIC use the saved notebook defaults');
  await saveNotebook(page);
  saved = await savedNotebook(request, name);
  const root = saved.metadata.nbinlineai;
  expect(root.defaultsInitialized).toBe(true);
  expect(['openai_api', 'anthropic_api']).toContain(root.defaults.backend);
  expect(root.defaults.model).toBeTruthy();
  expect(['compact', 'full', 'learning']).toContain(root.defaults.promptMode);
  expect(root.defaults.reasoningEffort).toBe('default');
  const promptMeta = saved.cells.find((item: any) => item.metadata?.nbinlineai?.isPromptCell).metadata.nbinlineai;
  for (const field of ['backend', 'model', 'promptMode', 'reasoningEffort']) expect(promptMeta[field]).toBeUndefined();
  const body = await postRun(page, prompt);
  expect(body.backend).toBe(root.defaults.backend);
  expect(body.model).toBe(root.defaults.model);
  expect(body.prompt_mode).toBe(root.defaults.promptMode);
});

test('model-only cell changes cannot send an inherited effort unsupported by the new model', async ({ page, request }) => {
  await openNotebook(page, request);
  const row = defaults(page);
  await row.locator('[data-nbinlineai-notebook-provider]').selectOption('openai_api');
  await row.locator('[data-nbinlineai-notebook-model-select]').selectOption('gpt-6-sol');
  const openaiEffort = row.locator('[data-nbinlineai-notebook-effort]');
  await expect(openaiEffort.locator('option')).toContainText(['Model default (medium)', 'none', 'low', 'medium', 'high', 'xhigh', 'max']);
  await openaiEffort.selectOption('none');
  const astraPrompt = await addPrompt(page, 'E2E_BASIC use Astra');
  await astraPrompt.locator('[data-nbinlineai-override]').click();
  await astraPrompt.locator('[data-nbinlineai-model-select]').selectOption('gpt-6-astra');
  const astraEffort = astraPrompt.locator('[data-nbinlineai-effort]');
  expect(await astraEffort.locator('option').allTextContents()).not.toContain('none');
  let body = await postRun(page, astraPrompt);
  expect(body).toMatchObject({ backend: 'openai_api', model: 'gpt-6-astra' });
  expect(body.reasoning_effort).toBeUndefined();

  await row.locator('[data-nbinlineai-notebook-provider]').selectOption('anthropic_api');
  await row.locator('[data-nbinlineai-notebook-model-select]').selectOption('claude-sonnet-5');
  await row.locator('[data-nbinlineai-notebook-effort]').selectOption('high');
  const haikuPrompt = await addPrompt(page, 'E2E_BASIC use Haiku');
  await haikuPrompt.locator('[data-nbinlineai-override]').click();
  await haikuPrompt.locator('[data-nbinlineai-model-select]').selectOption('claude-haiku-4-5-20251001');
  await expect(haikuPrompt.locator('[data-nbinlineai-effort] option')).toContainText(['Notebook default', 'Model default']);
  body = await postRun(page, haikuPrompt);
  expect(body).toMatchObject({ backend: 'anthropic_api', model: 'claude-haiku-4-5-20251001' });
  expect(body.reasoning_effort).toBeUndefined();
});

test('cell Model default effort overrides notebook High, then Notebook default restores it', async ({ page, request }) => {
  const name = await openNotebook(page, request);
  const row = defaults(page);
  await row.locator('[data-nbinlineai-notebook-provider]').selectOption('openai_api');
  await row.locator('[data-nbinlineai-notebook-model-select]').selectOption('gpt-6-luna');
  await row.locator('[data-nbinlineai-notebook-effort]').selectOption('high');
  const prompt = await addPrompt(page, 'E2E_BASIC compare effort defaults');
  await prompt.locator('[data-nbinlineai-override]').click();
  await expect(prompt.locator('[data-nbinlineai-model-select] option').first()).toContainText('gpt-6-luna');
  const effort = prompt.locator('[data-nbinlineai-effort]');
  await expect(effort.locator('option')).toContainText(['Notebook default', 'Model default', 'none', 'low', 'medium', 'high', 'xhigh', 'max']);
  await effort.selectOption('default');
  let body = await postRun(page, prompt);
  expect(body).toMatchObject({ backend: 'openai_api', model: 'gpt-6-luna' });
  expect(body.reasoning_effort).toBeUndefined();
  await saveNotebook(page);
  let saved = await savedNotebook(request, name);
  let meta = saved.cells.find((item: any) => item.metadata?.nbinlineai?.isPromptCell).metadata.nbinlineai;
  expect(meta.reasoningEffort).toBe('default');
  await effort.selectOption('');
  body = await postRun(page, prompt);
  expect(body.reasoning_effort).toBe('high');
  await saveNotebook(page);
  saved = await savedNotebook(request, name);
  meta = saved.cells.find((item: any) => item.metadata?.nbinlineai?.isPromptCell).metadata.nbinlineai;
  expect(meta.reasoningEffort).toBeUndefined();
});

test('notebook defaults persist and unmodified prompt cells keep inheriting them after a run', async ({ page, request }) => {
  const name = await openNotebook(page, request);
  const row = defaults(page);
  await row.locator('[data-nbinlineai-notebook-provider]').selectOption('anthropic_api');
  await row.locator('[data-nbinlineai-notebook-model-select]').selectOption('claude-sonnet-5');
  await row.locator('[data-nbinlineai-notebook-prompt-mode]').selectOption('learning');
  await row.locator('[data-nbinlineai-notebook-effort]').selectOption('low');
  const prompt = await addPrompt(page, 'E2E_BASIC inherit notebook defaults');
  await expect(prompt.locator('[data-nbinlineai-override-editor]')).toBeHidden();
  await expect(prompt.locator('[data-nbinlineai-override-summary]')).toBeEmpty();
  await page.screenshot({ path: 'test-results/nbinlineai-014-notebook-defaults.png', fullPage: true });
  let body = await postRun(page, prompt);
  expect(body).toMatchObject({ backend: 'anthropic_api', model: 'claude-sonnet-5', prompt_mode: 'learning', reasoning_effort: 'low' });
  await expect(notebook(page).locator('.nbinlineai-response-cell').first()).toContainText('effort=low');
  await saveNotebook(page);
  let saved = await savedNotebook(request, name);
  expect(saved.metadata.nbinlineai.defaults).toMatchObject({ backend: 'anthropic_api', model: 'claude-sonnet-5', promptMode: 'learning', reasoningEffort: 'low' });
  const cell = saved.cells.find((item: any) => item.metadata?.nbinlineai?.isPromptCell);
  for (const field of ['backend', 'model', 'promptMode', 'reasoningEffort']) expect(cell.metadata.nbinlineai[field]).toBeUndefined();

  await page.reload();
  await expect(row.locator('[data-nbinlineai-notebook-provider]')).toHaveValue('anthropic_api');
  await expect(row.locator('[data-nbinlineai-notebook-model-select]')).toHaveValue('claude-sonnet-5');
  await expect(row.locator('[data-nbinlineai-notebook-prompt-mode]')).toHaveValue('learning');
  await expect(row.locator('[data-nbinlineai-notebook-effort]')).toHaveValue('low');
  await expect(prompt.locator('[data-nbinlineai-override-summary]')).toBeEmpty();
  await row.locator('[data-nbinlineai-notebook-provider]').selectOption('openai_api');
  await row.locator('[data-nbinlineai-notebook-model-select]').selectOption('gpt-6-luna');
  await row.locator('[data-nbinlineai-notebook-prompt-mode]').selectOption('full');
  await row.locator('[data-nbinlineai-notebook-effort]').selectOption('high');
  body = await postRun(page, prompt);
  expect(body).toMatchObject({ backend: 'openai_api', model: 'gpt-6-luna', prompt_mode: 'full', reasoning_effort: 'high' });
  await saveNotebook(page);
  saved = await savedNotebook(request, name);
  const rerunCell = saved.cells.find((item: any) => item.metadata?.nbinlineai?.isPromptCell);
  for (const field of ['backend', 'model', 'promptMode', 'reasoningEffort']) expect(rerunCell.metadata.nbinlineai[field]).toBeUndefined();
});

test('cell overrides survive reload, then reset to the current notebook defaults', async ({ page, request }) => {
  const name = await openNotebook(page, request);
  const row = defaults(page);
  await row.locator('[data-nbinlineai-notebook-provider]').selectOption('anthropic_api');
  await row.locator('[data-nbinlineai-notebook-model-select]').selectOption('claude-sonnet-5');
  await row.locator('[data-nbinlineai-notebook-prompt-mode]').selectOption('learning');
  await row.locator('[data-nbinlineai-notebook-effort]').selectOption('low');
  const prompt = await addPrompt(page, 'E2E_BASIC cell override');
  await prompt.locator('[data-nbinlineai-override]').click();
  await prompt.locator('[data-nbinlineai-provider]').selectOption('openai_api');
  await prompt.locator('[data-nbinlineai-model-select]').selectOption('gpt-6-luna');
  await prompt.locator('[data-nbinlineai-prompt-mode]').selectOption('compact');
  await prompt.locator('[data-nbinlineai-effort]').selectOption('xhigh');
  let body = await postRun(page, prompt);
  expect(body).toMatchObject({ backend: 'openai_api', model: 'gpt-6-luna', prompt_mode: 'compact', reasoning_effort: 'xhigh' });
  await saveNotebook(page);
  let saved = await savedNotebook(request, name);
  let meta = saved.cells.find((item: any) => item.metadata?.nbinlineai?.isPromptCell).metadata.nbinlineai;
  expect(meta).toMatchObject({ backend: 'openai_api', model: 'gpt-6-luna', promptMode: 'compact', reasoningEffort: 'xhigh' });

  await page.reload();
  await expect(prompt.locator('[data-nbinlineai-override]')).toContainText('active');
  await prompt.locator('[data-nbinlineai-override]').click();
  await expect(prompt.locator('[data-nbinlineai-provider]')).toHaveValue('openai_api');
  await expect(prompt.locator('[data-nbinlineai-model-select]')).toHaveValue('gpt-6-luna');
  await expect(prompt.locator('[data-nbinlineai-prompt-mode]')).toHaveValue('compact');
  await expect(prompt.locator('[data-nbinlineai-effort]')).toHaveValue('xhigh');
  await row.locator('[data-nbinlineai-notebook-model-select]').selectOption('claude-haiku-4-5-20251001');
  await expect(row.locator('[data-nbinlineai-notebook-effort] option')).toContainText(['Model default']);
  body = await postRun(page, prompt);
  expect(body).toMatchObject({ backend: 'openai_api', model: 'gpt-6-luna', prompt_mode: 'compact', reasoning_effort: 'xhigh' });
  await prompt.locator('[data-nbinlineai-inherit]').click();
  await expect(prompt.locator('[data-nbinlineai-override-summary]')).toBeEmpty();
  body = await postRun(page, prompt);
  expect(body).toMatchObject({ backend: 'anthropic_api', model: 'claude-haiku-4-5-20251001', prompt_mode: 'learning' });
  expect(body.reasoning_effort).toBeUndefined();
  await saveNotebook(page);
  saved = await savedNotebook(request, name);
  meta = saved.cells.find((item: any) => item.metadata?.nbinlineai?.isPromptCell).metadata.nbinlineai;
  for (const field of ['backend', 'model', 'promptMode', 'reasoningEffort']) expect(meta[field]).toBeUndefined();
});

test('a cell model choice does not pin Anthropic after the notebook switches providers', async ({ page, request }) => {
  const name = await openNotebook(page, request);
  const row = defaults(page);
  await row.locator('[data-nbinlineai-notebook-provider]').selectOption('anthropic_api');
  const prompt = await addPrompt(page, 'E2E_BASIC inherit a changed provider');
  await prompt.locator('[data-nbinlineai-override]').click();
  const provider = prompt.locator('[data-nbinlineai-provider]');
  await expect(provider).toHaveValue('');
  await expect(provider.locator('option').first()).toContainText('Notebook default');
  await prompt.locator('[data-nbinlineai-model-select]').selectOption('claude-haiku-4-5-20251001');
  await saveNotebook(page);
  let saved = await savedNotebook(request, name);
  let meta = saved.cells.find((item: any) => item.metadata?.nbinlineai?.isPromptCell).metadata.nbinlineai;
  expect(meta.backend).toBeUndefined();
  expect(meta.model).toBe('claude-haiku-4-5-20251001');

  await row.locator('[data-nbinlineai-notebook-provider]').selectOption('openai_api');
  await expect(provider).toHaveValue('');
  await provider.selectOption('anthropic_api');
  await provider.selectOption('');
  const body = await postRun(page, prompt);
  expect(body.backend).toBe('openai_api');
  expect(body.model).toBeUndefined();
  await saveNotebook(page);
  saved = await savedNotebook(request, name);
  meta = saved.cells.find((item: any) => item.metadata?.nbinlineai?.isPromptCell).metadata.nbinlineai;
  expect(meta.backend).toBeUndefined();
  expect(meta.model).toBeUndefined();
});

test('Configure AI saves the connection default used by new notebooks', async ({ page, request }) => {
  await openNotebook(page, request);
  await page.getByRole('button', { name: 'Configure AI' }).first().click();
  const dialog = page.locator('[data-nbinlineai-keys-dialog]');
  const choice = dialog.locator('[data-nbinlineai-default-backend]');
  await expect(choice).toBeEnabled();
  const original = await choice.inputValue();
  const next = original === 'anthropic_api' ? 'openai_api' : 'anthropic_api';
  try {
    await choice.selectOption(next);
    await expect(dialog.locator('[data-nbinlineai-default-backend-notice]')).toContainText('default for new notebooks');
    await page.getByRole('button', { name: 'Done' }).click();
    await openNotebook(page, request);
    const prompt = await addPrompt(page, 'E2E_BASIC use the configured default');
    await expect(defaults(page).locator('[data-nbinlineai-notebook-provider]')).toHaveValue(next);
    await expect(prompt.locator('[data-nbinlineai-provider]')).toHaveValue('');
    const body = await postRun(page, prompt);
    expect(body.backend).toBe(next);
  } finally {
    if (!await dialog.isVisible()) await page.getByRole('button', { name: 'Configure AI' }).first().click();
    await choice.selectOption(original);
    await expect(dialog.locator('[data-nbinlineai-default-backend-notice]')).toContainText('default for new notebooks');
    await page.getByRole('button', { name: 'Done' }).click();
  }
});

test('custom style instructions save, reset, and reconcile an unconfirmed write', async ({ page, request }) => {
  const name = await openNotebook(page, request);
  await defaults(page).locator('[data-nbinlineai-notebook-prompt-mode]').selectOption('compact');
  const prompt = await addPrompt(page, 'E2E_BASIC explain value');
  await page.getByRole('button', { name: 'Configure AI' }).first().click();
  const dialog = page.locator('[data-nbinlineai-keys-dialog]');
  await expandCompactTemplate(dialog);
  const editor = dialog.locator('[data-nbinlineai-instruction="compact"]');
  const save = dialog.locator('[data-nbinlineai-instruction-save="compact"]');
  const reset = dialog.locator('[data-nbinlineai-instruction-reset="compact"]');
  await expect(editor).toHaveValue(/very succinctly/);
  await editor.fill('E2E_CUSTOM_COMPACT explain in one sentence.');
  await save.click();
  await expect(dialog.locator('.nbinlineai-template-row').first()).toContainText('Custom instructions saved');
  await page.screenshot({ path: 'test-results/nbinlineai-014-instruction-editor.png', fullPage: true });
  await page.getByRole('button', { name: 'Done' }).click();
  let body = await postRun(page, prompt);
  expect(body.prompt_instructions).toBe('E2E_CUSTOM_COMPACT explain in one sentence.');
  await expect(notebook(page).locator('.nbinlineai-response-cell').first()).toContainText('E2E_CUSTOM_COMPACT');
  await saveNotebook(page);
  const saved = await savedNotebook(request, name);
  expect(JSON.stringify(saved.metadata)).not.toContain('E2E_CUSTOM_COMPACT');
  expect(saved.cells.find((item: any) => item.metadata?.nbinlineai?.isPromptCell).source).not.toContain('E2E_CUSTOM_COMPACT');

  await page.reload();
  await page.getByRole('button', { name: 'Configure AI' }).first().click();
  await expandCompactTemplate(dialog);
  await expect(editor).toHaveValue('E2E_CUSTOM_COMPACT explain in one sentence.');
  await reset.click();
  await expect(dialog.locator('.nbinlineai-template-row').first()).toContainText('Using server default');
  await expect(editor).toHaveValue(/very succinctly/);
  await page.getByRole('button', { name: 'Done' }).click();
  body = await postRun(page, prompt);
  expect(body.prompt_instructions).toBeUndefined();
  await expect(notebook(page).locator('.nbinlineai-response-cell').first()).toContainText('very succinctly');

  let putSeen = false;
  await page.route('**/api/settings/**', async route => {
    if (!route.request().url().includes('nbinlineai')) return route.continue();
    if (route.request().method() === 'PUT') { putSeen = true; return route.continue(); }
    if (route.request().method() === 'GET' && putSeen) return route.fulfill({ status: 503, body: 'E2E confirmation unavailable' });
    return route.continue();
  });
  await page.getByRole('button', { name: 'Configure AI' }).first().click();
  await expandCompactTemplate(dialog);
  await editor.fill('E2E_UNCONFIRMED_COMPACT use exactly one line.');
  await save.click();
  await expect(dialog.locator('.nbinlineai-template-row').first()).toContainText('Could not confirm this change');
  expect(putSeen).toBe(true);
  await expect(dialog.locator('[data-nbinlineai-style-retry]')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  body = await postRun(page, prompt);
  expect(body.prompt_instructions).toBeUndefined();
  await page.getByRole('button', { name: 'Configure AI' }).first().click();
  await page.unroute('**/api/settings/**');
  await dialog.locator('[data-nbinlineai-style-retry]').click();
  await expandCompactTemplate(dialog);
  await expect(editor).toHaveValue('E2E_UNCONFIRMED_COMPACT use exactly one line.');
  await page.getByRole('button', { name: 'Done' }).click();
  body = await postRun(page, prompt);
  expect(body.prompt_instructions).toBe('E2E_UNCONFIRMED_COMPACT use exactly one line.');
});
