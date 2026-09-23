import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

type Cell = {
  id: string;
  cell_type: 'code' | 'markdown';
  source: string;
  metadata: Record<string, unknown>;
  outputs?: object[];
  execution_count?: null;
};

const code = (id: string, source: string): Cell => ({
  id, cell_type: 'code', source, metadata: {}, outputs: [], execution_count: null
});
const ai = (id: string, source: string, keepAnswer?: boolean): Cell => ({
  id, cell_type: 'markdown', source,
  metadata: { nbinlineai: { isPromptCell: true, ...(keepAnswer !== undefined && { keepAnswer }) } }
});
const answer = (id: string, promptId: string, source: string): Cell => ({
  id, cell_type: 'markdown', source,
  metadata: { nbinlineai: { isOutputCell: true, promptCellId: promptId, status: 'done' } }
});
const panel = (page: Page) => page.locator('.jp-NotebookPanel:visible');
const notebook = (page: Page) => panel(page).locator('.jp-Notebook');
const prompts = (page: Page) => notebook(page).locator('.nbinlineai-prompt-cell');

test.beforeEach(async ({ request }) => {
  await request.get('/lab');
  const xsrf = (await request.storageState()).cookies.find(cookie => cookie.name === '_xsrf')?.value;
  expect(xsrf).toBeTruthy();
  const response = await request.post('/nbinlineai/settings/keys', {
    headers: { 'X-XSRFToken': xsrf! },
    data: { backend: 'openai_api', key: 'e2e-no-network-openai' }
  });
  expect(response.ok(), await response.text()).toBeTruthy();
});

async function openNotebook(page: Page, request: APIRequestContext, cells: Cell[], defaults?: Record<string, unknown>) {
  const name = `run-all-${Date.now()}-${Math.floor(Math.random() * 1e6)}.ipynb`;
  const xsrf = (await request.storageState()).cookies.find(cookie => cookie.name === '_xsrf')?.value;
  const response = await request.put(`/api/contents/${name}`, {
    headers: { 'X-XSRFToken': xsrf! },
    data: { type: 'notebook', format: 'json', content: {
      cells,
      metadata: {
        kernelspec: { display_name: 'Python 3 (ipykernel)', language: 'python', name: 'python3' },
        ...(defaults && { nbinlineai: { defaults, defaultsInitialized: true } })
      },
      nbformat: 4, nbformat_minor: 5
    } }
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  await page.goto(`/lab/workspaces/${name.slice(0, -6)}/tree/${name}`);
  await expect(notebook(page).locator('.jp-Cell')).toHaveCount(cells.length);
  await expect(prompts(page)).toHaveCount(cells.filter(cell => (cell.metadata.nbinlineai as { isPromptCell?: boolean } | undefined)?.isPromptCell).length);
  await expect.poll(async () => {
    const sessions = await request.get('/api/sessions');
    return sessions.ok() && (await sessions.json()).some((session: any) => session.path === name && session.kernel?.id);
  }).toBeTruthy();
  return name;
}

async function runAllFromMenu(page: Page) {
  await page.locator('.lm-MenuBar-item').filter({ hasText: /^Run$/ }).click();
  await page.getByRole('menuitem', { name: 'Run All Cells', exact: true }).click();
}

test('native Run All awaits code, AI tool mutation, later code, and a later AI prompt in notebook order', async ({ page, request }) => {
  await openNotebook(page, request, [
    code('setup', 'counter = 0\ndef bump(value: int):\n    global counter\n    counter += value\n    return counter'),
    ai('tool', 'E2E_TOOL call &`bump` once'),
    code('inspect', 'after_ai = counter\nprint("AFTER_AI_VALUE", after_ai)'),
    ai('later', 'E2E_BASIC inspect $`after_ai`')
  ]);
  const posts: string[] = [];
  page.on('request', item => {
    if (item.url().endsWith('/nbinlineai/prompt') && item.method() === 'POST') posts.push(item.postData() || '');
  });
  await runAllFromMenu(page);
  await expect(notebook(page).locator('.jp-CodeCell').nth(1).locator('.jp-OutputArea')).toContainText('AFTER_AI_VALUE 4');
  await expect(prompts(page).last().locator('.nbinlineai-status')).toContainText(/Done|Answer kept/);
  const answers = notebook(page).locator('.nbinlineai-response-cell');
  await expect(answers).toHaveCount(2);
  await expect(answers.last()).toContainText('E2E_BASIC inspect 4');
  expect(posts).toHaveLength(2);
  expect(JSON.parse(posts[0]).prompt).toContain('E2E_TOOL');
  expect(JSON.parse(posts[1]).prompt).toContain('E2E_BASIC');
});

test('native Run All skips a kept completed answer, then notebook Keep off permits the provider request', async ({ page, request }) => {
  await openNotebook(page, request, [
    code('setup', 'keep_run_count = 1'),
    ai('kept', 'E2E_BASIC rerun when allowed'),
    answer('kept-output', 'kept', 'SAVED_ANSWER_TO_KEEP'),
    code('later', 'print("KEEP_LATER_CODE_RAN")')
  ], { backend: 'openai_api', model: 'gpt-6-sol', promptMode: 'compact', reasoningEffort: 'default', keepAnswers: true });
  const posts: string[] = [];
  page.on('request', item => {
    if (item.url().endsWith('/nbinlineai/prompt') && item.method() === 'POST') posts.push(item.postData() || '');
  });
  await runAllFromMenu(page);
  await expect(notebook(page).locator('.jp-CodeCell').last().locator('.jp-OutputArea')).toContainText('KEEP_LATER_CODE_RAN');
  await expect(notebook(page).locator('.nbinlineai-response-cell')).toContainText('SAVED_ANSWER_TO_KEEP');
  expect(posts).toHaveLength(0);

  await panel(page).locator('[data-nbinlineai-notebook-keep-answers]').uncheck();
  await runAllFromMenu(page);
  await expect(prompts(page).first().locator('.nbinlineai-status')).toContainText(/Done|Answer kept/);
  await expect(notebook(page).locator('.nbinlineai-response-cell')).toHaveCount(1);
  await expect(notebook(page).locator('.nbinlineai-response-cell')).not.toContainText('SAVED_ANSWER_TO_KEEP');
  expect(posts).toHaveLength(1);
});

test('native Run All respects inherited, explicit on, and explicit off Keep choices', async ({ page, request }) => {
  await openNotebook(page, request, [
    ai('inherit', 'E2E_BASIC inherited choice'), answer('inherit-output', 'inherit', 'KEEP_INHERITED'),
    ai('on', 'E2E_BASIC explicit on', true), answer('on-output', 'on', 'EDITED_KEEP_TRUE'),
    ai('off', 'E2E_BASIC explicit off', false), answer('off-output', 'off', 'REPLACE_EXPLICIT_FALSE')
  ], { backend: 'openai_api', model: 'gpt-6-sol', promptMode: 'compact', reasoningEffort: 'default', keepAnswers: true });
  const promptIds: string[] = [];
  page.on('request', item => {
    if (item.url().endsWith('/nbinlineai/prompt') && item.method() === 'POST') {
      promptIds.push(item.postDataJSON().prompt_cell_id);
    }
  });
  await runAllFromMenu(page);
  await expect(notebook(page).locator('.nbinlineai-response-cell').last()).not.toContainText('REPLACE_EXPLICIT_FALSE');
  expect(promptIds).toEqual(['off']);
  await expect(notebook(page).locator('.nbinlineai-response-cell').nth(1)).toContainText('EDITED_KEEP_TRUE');

  await panel(page).locator('[data-nbinlineai-notebook-keep-answers]').uncheck();
  await runAllFromMenu(page);
  await expect.poll(() => promptIds.length).toBe(3);
  expect(promptIds).toEqual(['off', 'inherit', 'off']);
  await expect(notebook(page).locator('.nbinlineai-response-cell').nth(1)).toContainText('EDITED_KEEP_TRUE');
  await expect(notebook(page).locator('.nbinlineai-response-cell').first()).not.toContainText('KEEP_INHERITED');
});

test('native Run All stops after an AI error and a later batch can complete', async ({ page, request }) => {
  await openNotebook(page, request, [
    code('setup', 'run_all_flag = 1'),
    ai('failure', 'E2E_ERROR'),
    code('later', 'print("LATER_CODE_RAN")')
  ]);
  await runAllFromMenu(page);
  await expect(prompts(page).first().locator('.nbinlineai-status')).toContainText(/error|fail/i);
  await expect(notebook(page).locator('.jp-CodeCell').nth(1).locator('.jp-OutputArea')).not.toContainText('LATER_CODE_RAN');
  await prompts(page).first().dblclick();
  await prompts(page).first().locator('.cm-content').fill('E2E_BASIC recovered');
  await runAllFromMenu(page);
  await expect(prompts(page).first().locator('.nbinlineai-status')).toContainText(/Done|Answer kept/);
  await expect(notebook(page).locator('.jp-CodeCell').nth(1).locator('.jp-OutputArea')).toContainText('LATER_CODE_RAN');
});

test('native Run All stops on a Python error before AI, then succeeds after correction', async ({ page, request }) => {
  await openNotebook(page, request, [
    code('bad', 'raise RuntimeError("E2E_CODE_FAIL")'),
    ai('after', 'E2E_BASIC provider should wait for corrected code')
  ]);
  let count = 0;
  page.on('request', item => {
    if (item.url().endsWith('/nbinlineai/prompt') && item.method() === 'POST') count += 1;
  });
  await runAllFromMenu(page);
  const firstCode = notebook(page).locator('.jp-CodeCell').first();
  await expect(firstCode.locator('.jp-OutputArea')).toContainText('E2E_CODE_FAIL');
  await expect(prompts(page).first().locator('.nbinlineai-status')).not.toContainText(/Done|Answer kept/);
  expect(count).toBe(0);
  await firstCode.locator('.cm-content').fill('corrected_value = 5');
  await runAllFromMenu(page);
  await expect(prompts(page).first().locator('.nbinlineai-status')).toContainText(/Done|Answer kept/);
  expect(count).toBe(1);
});

test('native Run All cancellation stops later cells and does not poison the next batch', async ({ page, request }) => {
  await openNotebook(page, request, [
    code('setup', 'run_all_flag = 1'),
    ai('slow', 'E2E_SLOW'),
    code('later', 'print("CANCELLED_LATER_CODE_RAN")')
  ]);
  await runAllFromMenu(page);
  const cancel = prompts(page).first().locator('[data-nbinlineai-cancel]');
  await expect(cancel).toBeEnabled();
  await cancel.click();
  await expect(prompts(page).first().locator('.nbinlineai-status')).toHaveText('Cancelled');
  await expect(cancel).toBeDisabled();
  await expect(notebook(page).locator('.jp-CodeCell').nth(1).locator('.jp-OutputArea')).not.toContainText('CANCELLED_LATER_CODE_RAN');
  await prompts(page).first().dblclick();
  await prompts(page).first().locator('.cm-content').fill('E2E_BASIC recovered');
  await runAllFromMenu(page);
  await expect(notebook(page).locator('.jp-CodeCell').nth(1).locator('.jp-OutputArea')).toContainText('CANCELLED_LATER_CODE_RAN');
});

test('overlapping native Run All commands share one pending AI request and both stop on cancellation', async ({ page, request }) => {
  await openNotebook(page, request, [
    ai('slow', 'E2E_SLOW'),
    code('later', 'print("OVERLAP_LATER_CODE_RAN")')
  ]);
  let count = 0;
  page.on('request', item => {
    if (item.url().endsWith('/nbinlineai/prompt') && item.method() === 'POST') count += 1;
  });
  await runAllFromMenu(page);
  const prompt = prompts(page).first();
  const cancel = prompt.locator('[data-nbinlineai-cancel]');
  await expect(cancel).toBeEnabled();
  await runAllFromMenu(page);
  await cancel.click();
  await expect(prompt.locator('.nbinlineai-status')).toContainText(/cancel|stopp?ed/i);
  await expect.poll(() => count).toBe(1);
  await expect(notebook(page).locator('.jp-CodeCell').last().locator('.jp-OutputArea')).not.toContainText('OVERLAP_LATER_CODE_RAN');
  await prompt.dblclick();
  await prompt.locator('.cm-content').fill('E2E_BASIC fresh run');
  await runAllFromMenu(page);
  await expect(notebook(page).locator('.jp-CodeCell').last().locator('.jp-OutputArea')).toContainText('OVERLAP_LATER_CODE_RAN');
  expect(count).toBe(2);
});

test('one Shift+Enter on an AI prompt makes one provider request', async ({ page, request }) => {
  await openNotebook(page, request, [code('setup', 'value = 1'), ai('prompt', 'E2E_BASIC once')]);
  let count = 0;
  page.on('request', item => {
    if (item.url().endsWith('/nbinlineai/prompt') && item.method() === 'POST') count += 1;
  });
  await prompts(page).first().click();
  await page.keyboard.press('Shift+Enter');
  await expect(prompts(page).first().locator('.nbinlineai-status')).toContainText(/Done|Answer kept/);
  await expect(notebook(page).locator('.nbinlineai-response-cell')).toHaveCount(1);
  expect(count).toBe(1);
});
