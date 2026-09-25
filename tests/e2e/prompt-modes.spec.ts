import { expect, test, type APIRequestContext, type Locator, type Page } from '../support/e2e-fixtures';

const showDefaults = (dialog: Locator) => dialog.getByRole('tab', { name: 'Defaults' }).click();

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
  const name = `prompt-modes-${Date.now()}-${Math.floor(Math.random() * 1e6)}.ipynb`;
  const xsrf = (await request.storageState()).cookies.find(cookie => cookie.name === '_xsrf')?.value;
  expect(xsrf).toBeTruthy();
  const created = await request.put(`/api/contents/${name}`, {
    headers: { 'X-XSRFToken': xsrf! },
    data: {
      type: 'notebook', format: 'json', content: {
        cells: [{ id: 'setup', cell_type: 'code', source: 'value = 2', metadata: {}, outputs: [], execution_count: null }],
        metadata: { kernelspec: { display_name: 'Python 3 (ipykernel)', language: 'python', name: 'python3' } },
        nbformat: 4, nbformat_minor: 5
      }
    }
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  await page.goto(`/lab/workspaces/${name.slice(0, -6)}/tree/${name}`);
  await expect(page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-CodeCell')).toHaveCount(1);
  await expect.poll(async () => {
    const response = await request.get('/api/sessions');
    if (!response.ok()) return false;
    return (await response.json()).some((session: any) => session.path === name && session.kernel?.id);
  }).toBeTruthy();
  return name;
}

async function setMode(page: Page, mode: 'compact' | 'full' | 'learning', screenshot = false) {
  await page.getByRole('button', { name: 'Configure AI' }).first().click();
  const dialog = page.locator('[data-nbinlineai-keys-dialog]');
  await showDefaults(dialog);
  const select = dialog.locator('select[data-nbinlineai-prompt-mode]');
  await expect(select).toBeVisible();
  await select.selectOption(mode);
  await expect(dialog.locator('.nbinlineai-style-notice')).toContainText(
    `${mode.charAt(0).toUpperCase()}${mode.slice(1)} is now your user default`
  );
  await expect(select).toBeEnabled();
  if (screenshot) await page.screenshot({ path: 'test-results/nbinlineai-013-configure-style.png', fullPage: true });
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();
}

async function resetBundledInstructions(page: Page) {
  await page.getByRole('button', { name: 'Configure AI' }).first().click();
  const dialog = page.locator('[data-nbinlineai-keys-dialog]');
  await showDefaults(dialog);
  const details = dialog.locator('[data-nbinlineai-template-details]');
  await details.locator(':scope > summary').click();
  for (const mode of ['compact', 'full', 'learning']) {
    const row = details.locator(`[data-nbinlineai-template-mode="${mode}"]`);
    if (await row.getAttribute('open') === null) await row.locator(':scope > summary').click();
    const reset = row.locator(`[data-nbinlineai-instruction-reset="${mode}"]`);
    if (await reset.isEnabled()) {
      await reset.click();
      await expect(row.locator('.nbinlineai-template-state')).toContainText('Using server default for future runs');
    }
  }
  await page.getByRole('button', { name: 'Done' }).click();
}

async function addPromptAfter(page: Page, cellIndex: number, source: string) {
  const notebook = page.locator('.jp-NotebookPanel:visible .jp-Notebook');
  await notebook.locator('.jp-Cell').nth(cellIndex).click();
  await page.getByRole('button', { name: 'AI Prompt' }).click();
  const prompt = notebook.locator('.jp-Cell.nbinlineai-prompt-cell').last();
  await expect(prompt).toBeVisible();
  await prompt.locator('.cm-content').fill(source);
  return prompt;
}

async function runAndCaptureMode(page: Page, prompt: Locator, mode: string) {
  const run = prompt.locator('button[data-nbinlineai-run]');
  if (await run.isDisabled()) {
    await prompt.locator('[data-nbinlineai-keep-answer]').uncheck();
    await expect(run).toBeEnabled();
  }
  const posted = page.waitForRequest(item => item.url().endsWith('/nbinlineai/prompt') && item.method() === 'POST');
  await run.click();
  expect((await posted).postDataJSON().prompt_mode).toBe(mode);
  await expect(prompt.locator('.nbinlineai-status')).toContainText(/Done|Answer kept/);
}

test('saved response style controls requests, server instructions, and learning history', async ({ page, request }) => {
  await openNotebook(page, request);
  await resetBundledInstructions(page);
  await setMode(page, 'full', true);
  const prompt = await addPromptAfter(page, 0, 'E2E_STYLE explain value');
  const answer = page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-Cell.nbinlineai-response-cell').first();

  await runAndCaptureMode(page, prompt, 'full');
  await expect(answer).toContainText('Response style for this run (full)');
  await expect(answer).toContainText('detailed, well-structured');
  await expect(page.locator('.jp-NotebookPanel:visible [data-nbinlineai-notebook-prompt-mode]')).toHaveValue('full');

  await page.locator('.jp-NotebookPanel:visible [data-nbinlineai-notebook-prompt-mode]').selectOption('compact');
  await runAndCaptureMode(page, prompt, 'compact');
  await expect(answer).toContainText('Response style for this run (compact)');
  await expect(answer).toContainText('very succinctly');

  await page.locator('.jp-NotebookPanel:visible [data-nbinlineai-notebook-prompt-mode]').selectOption('learning');
  await setMode(page, 'learning');
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.getByText('Saving completed')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Configure AI' }).first().click();
  const dialog = page.locator('[data-nbinlineai-keys-dialog]');
  await showDefaults(dialog);
  await expect(dialog.locator('select[data-nbinlineai-prompt-mode]')).toHaveValue('learning');
  await page.getByRole('button', { name: 'Done' }).click();

  await prompt.locator('.jp-RenderedHTMLCommon').dblclick();
  await expect(prompt.locator('.cm-content')).toBeVisible();
  await prompt.locator('.cm-content').fill('E2E_LEARNING_FIRST explain value');
  await runAndCaptureMode(page, prompt, 'learning');
  await expect(answer).toContainText('E2E_FIRST_TUTOR_REPLY');
  const nextPrompt = await addPromptAfter(page, 2, 'E2E_LEARNING_SECOND follow up');
  await runAndCaptureMode(page, nextPrompt, 'learning');
  const nextAnswer = page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-Cell.nbinlineai-response-cell').last();
  await expect(nextAnswer).toContainText('Socratic tutor');
  await expect(nextAnswer).toContainText('wait for their next AI cell');
  await expect(nextAnswer).toContainText('E2E_LEARNING_FIRST explain value');
  await expect(nextAnswer).toContainText('E2E_FIRST_TUTOR_REPLY');
});

test('fenced code copy works in compact and full modes without changing notebook source', async ({ page, request }) => {
  await page.addInitScript(() => {
    (window as any).__copiedCode = [];
    (window as any).__copyShouldFail = false;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (value: string) => {
        if ((window as any).__copyShouldFail) throw new Error('E2E clipboard failure');
        (window as any).__copiedCode.push(value);
      } }
    });
  });
  const name = await openNotebook(page, request);
  await setMode(page, 'compact');
  const prompt = await addPromptAfter(page, 0, 'E2E_CODE_BLOCK show an example');
  const answer = page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-Cell.nbinlineai-response-cell').first();
  const pre = answer.locator('.jp-RenderedHTMLCommon pre').first();
  const code = pre.locator('code');
  const copy = pre.locator('button[data-nbinlineai-copy-code]');
  await runAndCaptureMode(page, prompt, 'compact');
  await expect(code).toContainText('value = 2 + 2\nprint(value)');
  await expect(copy).toHaveCount(1);
  await pre.hover();
  await page.screenshot({ path: 'test-results/nbinlineai-013-copy-code.png', fullPage: true });
  await copy.click();
  await expect(copy).toHaveAttribute('aria-label', 'Copied');
  const exactCode = await code.textContent();
  expect(await page.evaluate(() => (window as any).__copiedCode.at(-1))).toBe(exactCode);

  await runAndCaptureMode(page, prompt, 'compact');
  await expect(copy).toHaveCount(1);
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.getByText('Saving completed')).toBeVisible();
  const saved = await request.get(`/api/contents/${name}?content=1`);
  expect(saved.ok()).toBeTruthy();
  const notebook = await saved.json();
  const source = notebook.content.cells.find((cell: any) => cell.metadata?.nbinlineai?.promptCellId)?.source;
  expect(source).toContain('```python\nvalue = 2 + 2\nprint(value)\n```');
  expect(source).not.toContain('Copy code');
  expect(source).not.toContain('data-nbinlineai-copy-code');

  await page.reload();
  await expect(copy).toHaveCount(1);
  await setMode(page, 'full');
  await page.locator('.jp-NotebookPanel:visible [data-nbinlineai-notebook-prompt-mode]').selectOption('full');
  await runAndCaptureMode(page, prompt, 'full');
  await expect(copy).toHaveCount(1);
  await pre.hover();
  await copy.click();
  await expect(copy).toHaveAttribute('aria-label', 'Copied');
  expect(await page.evaluate(() => (window as any).__copiedCode.at(-1))).toBe(await code.textContent());

  await page.evaluate(() => { (window as any).__copyShouldFail = true; });
  await pre.hover();
  await copy.click();
  await expect(copy).toHaveAttribute('aria-label', 'Copy failed');

  const followUp = await addPromptAfter(page, 2, 'E2E_BASIC inspect the previous AI answer');
  await runAndCaptureMode(page, followUp, 'full');
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.getByText('Saving completed')).toBeVisible();
  const finalSaved = await request.get(`/api/contents/${name}?content=1`);
  const finalNotebook = await finalSaved.json();
  const outputSources = finalNotebook.content.cells
    .filter((cell: any) => cell.metadata?.nbinlineai?.promptCellId)
    .map((cell: any) => cell.source as string);
  expect(outputSources).toHaveLength(2);
  expect(outputSources[1]).toContain('value = 2 + 2');
  expect(outputSources.join('\n')).not.toContain('Copy code');
  expect(outputSources.join('\n')).not.toContain('data-nbinlineai-copy-code');
});

test('uncertain style save keeps the last confirmed mode until Retry reconciles it', async ({ page, request }) => {
  await openNotebook(page, request);
  await setMode(page, 'compact');
  const prompt = await addPromptAfter(page, 0, 'E2E_STYLE confirm response style');
  await page.locator('.jp-NotebookPanel:visible [data-nbinlineai-notebook-prompt-mode]').selectOption('');
  let putSeen = false;
  await page.route('**/api/settings/**', async route => {
    if (!route.request().url().includes('nbinlineai')) return route.continue();
    const method = route.request().method();
    if (method === 'PUT') {
      putSeen = true;
      return route.continue();
    }
    if (method === 'GET' && putSeen) {
      return route.fulfill({ status: 503, body: 'E2E settings confirmation unavailable' });
    }
    return route.continue();
  });
  await page.getByRole('button', { name: 'Configure AI' }).first().click();
  const dialog = page.locator('[data-nbinlineai-keys-dialog]');
  await showDefaults(dialog);
  await dialog.locator('select[data-nbinlineai-prompt-mode]').selectOption('full');
  await expect(dialog.locator('.nbinlineai-style-notice')).toContainText(
    'Could not confirm the response style save. Choose Retry response style settings to check what was saved.'
  );
  expect(putSeen).toBe(true);
  await expect(dialog.locator('[data-nbinlineai-style-retry]')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await runAndCaptureMode(page, prompt, 'compact');

  await page.getByRole('button', { name: 'Configure AI' }).first().click();
  await showDefaults(dialog);
  await expect(dialog.locator('[data-nbinlineai-style-retry]')).toBeVisible();
  await page.unroute('**/api/settings/**');
  await dialog.locator('[data-nbinlineai-style-retry]').click();
  await expect(dialog.locator('select[data-nbinlineai-prompt-mode]')).toHaveValue('full');
  await expect(dialog.locator('.nbinlineai-style-notice')).toContainText('Full is the current response style.');
  await page.getByRole('button', { name: 'Done' }).click();
  await runAndCaptureMode(page, prompt, 'full');
});
