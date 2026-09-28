import { expect, test, type APIRequestContext, type Page } from '../support/e2e-fixtures';

type Cell = { id: string; cell_type: 'code' | 'markdown'; source: string; metadata: object; outputs?: object[]; execution_count?: null };
const code = (id: string, source: string): Cell => ({ id, cell_type: 'code', source, metadata: {}, outputs: [], execution_count: null });
const ai = (id: string, source: string): Cell => ({ id, cell_type: 'markdown', source, metadata: { nbinlineai: { isPromptCell: true } } });
const setup = code('setup', 'from nbinlineai.tools import add_code_cell_and_execute, prompt_and_run, run_and_prompt');

async function runSetup(page: Page): Promise<void> {
  const notebook = page.locator('.jp-NotebookPanel:visible .jp-Notebook');
  await notebook.locator('.jp-CodeCell').first().click();
  await page.keyboard.press('Shift+Enter');
  await expect(notebook.locator('.jp-CodeCell').first().locator('.jp-InputPrompt')).toContainText('[1]');
}

async function openNotebook(page: Page, request: APIRequestContext, cells: Cell[]): Promise<void> {
  const name = `handoff-${Date.now()}-${Math.floor(Math.random() * 1e6)}.ipynb`;
  await request.get('/lab');
  const xsrf = (await request.storageState()).cookies.find(cookie => cookie.name === '_xsrf')?.value;
  expect(xsrf).toBeTruthy();
  const key = await request.post('/nbinlineai/settings/keys', {
    headers: { 'X-XSRFToken': xsrf! }, data: { backend: 'openai_api', key: 'e2e-no-network-openai' }
  });
  expect(key.ok(), await key.text()).toBeTruthy();
  const created = await request.put(`/api/contents/${name}`, {
    headers: { 'X-XSRFToken': xsrf! }, data: { type: 'notebook', format: 'json', content: {
      cells, metadata: { kernelspec: { display_name: 'Python 3 (ipykernel)', language: 'python', name: 'python3' } },
      nbformat: 4, nbformat_minor: 5
    } }
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  await page.goto(`/lab/workspaces/${name.slice(0, -6)}/tree/${name}`);
  await expect(page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-Cell')).toHaveCount(cells.length);
  await expect.poll(async () => {
    const response = await request.get('/api/sessions');
    return response.ok() && (await response.json()).some((session: any) => session.path === name && session.kernel?.id);
  }).toBeTruthy();
  await expect(page.getByRole('button', { name: /Python.*\| Idle$/ })).toBeVisible();
}

test('AI terminal add inserts and natively executes code before later Run All work', async ({ page, request }) => {
  await openNotebook(page, request, [
    setup,
    ai('ask', 'E2E_HANDOFF_ADD &`add_code_cell_and_execute`'),
    code('later', 'print("LATER_MARKER", handoff_value)')
  ]);
  const notebook = page.locator('.jp-NotebookPanel:visible .jp-Notebook');
  await page.locator('.lm-MenuBar-item').filter({ hasText: /^Run$/ }).click();
  await page.getByRole('menuitem', { name: 'Run All Cells', exact: true }).click();
  const inserted = notebook.locator('.jp-CodeCell').filter({ hasText: 'HANDOFF_ADD_RESULT' });
  await expect(inserted).toHaveCount(1);
  await expect(inserted.locator('.jp-OutputArea')).toContainText('HANDOFF_ADD_RESULT 41');
  await expect(notebook.locator('.jp-CodeCell').filter({ hasText: 'LATER_MARKER' }).locator('.jp-OutputArea')).toContainText('LATER_MARKER 41');
  const ids = await notebook.locator('.jp-Cell').evaluateAll(cells => cells.map(cell => cell.textContent || ''));
  expect(ids.findIndex(text => text.includes('HANDOFF_ADD_RESULT'))).toBeLessThan(ids.findIndex(text => text.includes('LATER_MARKER')));
});

test('a completed terminal handoff is kept and does not replay on another run', async ({ page, request }) => {
  await openNotebook(page, request, [setup, ai('ask', 'E2E_HANDOFF_ADD &`add_code_cell_and_execute`')]);
  const notebook = page.locator('.jp-NotebookPanel:visible .jp-Notebook');
  await runSetup(page);
  const prompt = notebook.locator('.nbinlineai-prompt-cell');
  await prompt.locator('[data-nbinlineai-run]').click();
  await expect(notebook.locator('.jp-CodeCell').last().locator('.jp-OutputArea')).toContainText('HANDOFF_ADD_RESULT 41');
  await expect(notebook.locator('.nbinlineai-response-cell')).toContainText('Handoff scheduled for cell');
  await prompt.locator('[data-nbinlineai-run]').click();
  await expect(notebook.locator('.jp-CodeCell')).toHaveCount(2);
  await expect(notebook.locator('.jp-CodeCell').last().locator('.jp-InputPrompt')).toContainText('[2]');
});

test('AI terminal execution accepts an existing identified code cell', async ({ page, request }) => {
  await openNotebook(page, request, [
    setup,
    ai('ask', 'E2E_HANDOFF_EXISTING &`add_code_cell_and_execute`'),
    code('target', 'print("EXISTING_TARGET_RAN")')
  ]);
  const notebook = page.locator('.jp-NotebookPanel:visible .jp-Notebook');
  await runSetup(page);
  await notebook.locator('.nbinlineai-prompt-cell [data-nbinlineai-run]').click();
  await expect(notebook.locator('.jp-CodeCell').filter({ hasText: 'EXISTING_TARGET_RAN' }).locator('.jp-OutputArea')).toContainText('EXISTING_TARGET_RAN');
  await expect(notebook.locator('.jp-CodeCell')).toHaveCount(2);
});

test('Run All coalesces an upcoming explicit run of the same identified cell', async ({ page, request }) => {
  await openNotebook(page, request, [
    setup,
    ai('ask', 'E2E_HANDOFF_EXISTING &`add_code_cell_and_execute`'),
    code('target', 'overlap_count = globals().get("overlap_count", 0) + 1\nprint("OVERLAP_COUNT", overlap_count)')
  ]);
  const notebook = page.locator('.jp-NotebookPanel:visible .jp-Notebook');
  await page.locator('.lm-MenuBar-item').filter({ hasText: /^Run$/ }).click();
  await page.getByRole('menuitem', { name: 'Run All Cells', exact: true }).click();
  const target = notebook.locator('.jp-CodeCell').filter({ hasText: 'OVERLAP_COUNT' });
  await expect(target.locator('.jp-OutputArea')).toContainText('OVERLAP_COUNT 1');
  await expect(target.locator('.jp-InputPrompt')).toContainText('[2]');
});

test('editing a bound code source before dispatch stops the handoff', async ({ page, request }) => {
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await original(...args);
      if (String(args[0]).includes('/nbinlineai/action-reply')) {
        (window as any).__handoffReplyHeld = true;
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      return response;
    };
  });
  await openNotebook(page, request, [
    setup,
    ai('ask', 'E2E_HANDOFF_EXISTING &`add_code_cell_and_execute`'),
    code('target', 'print("STALE_ORIGINAL")')
  ]);
  const notebook = page.locator('.jp-NotebookPanel:visible .jp-Notebook');
  await runSetup(page);
  await notebook.locator('.nbinlineai-prompt-cell [data-nbinlineai-run]').click();
  await page.waitForFunction(() => (window as any).__handoffReplyHeld === true);
  await notebook.locator('.jp-CodeCell').last().locator('.cm-content').fill('print("STALE_EDIT")');
  await expect(notebook.locator('.nbinlineai-prompt-cell').first().locator('.nbinlineai-status')).toContainText(/changed|stopped/i);
  await expect(notebook.locator('.jp-CodeCell').last().locator('.jp-OutputArea-output')).toHaveCount(0);
});

test('run_and_prompt transfers the exact code result to a separate AI question', async ({ page, request }) => {
  await openNotebook(page, request, [setup, ai('ask', 'E2E_HANDOFF_RUN_PROMPT &`run_and_prompt`')]);
  const notebook = page.locator('.jp-NotebookPanel:visible .jp-Notebook');
  await runSetup(page);
  let promptRequests = 0;
  page.on('request', item => { if (item.url().endsWith('/nbinlineai/prompt') && item.method() === 'POST') promptRequests++; });
  await notebook.locator('.nbinlineai-prompt-cell [data-nbinlineai-run]').click();
  await expect(notebook.locator('.jp-CodeCell').filter({ hasText: 'HANDOFF_RESULT' }).locator('.jp-OutputArea')).toContainText('HANDOFF_RESULT 42');
  await expect(notebook.locator('.nbinlineai-response-cell').last()).toContainText('HANDOFF_P1_RECEIVED');
  await expect(notebook.locator('.nbinlineai-response-cell').last()).toContainText('HANDOFF_RESULT 42');
  expect(promptRequests).toBe(2);
});

test('run_and_prompt accepts an existing code ID and transfers that execution', async ({ page, request }) => {
  await openNotebook(page, request, [
    setup,
    ai('ask', 'E2E_HANDOFF_RUN_PROMPT_EXISTING &`run_and_prompt`'),
    code('target', 'print("HANDOFF_RESULT", 53)')
  ]);
  const notebook = page.locator('.jp-NotebookPanel:visible .jp-Notebook');
  await runSetup(page);
  await notebook.locator('.nbinlineai-prompt-cell [data-nbinlineai-run]').click();
  await expect(notebook.locator('.jp-CodeCell').last().locator('.jp-OutputArea')).toContainText('HANDOFF_RESULT 53');
  await expect(notebook.locator('.nbinlineai-response-cell').last()).toContainText('HANDOFF_RESULT 53');
});

test('prompt_and_run creates a distinct question which selects and executes code', async ({ page, request }) => {
  await openNotebook(page, request, [setup, ai('ask', 'E2E_HANDOFF_PROMPT_RUN &`prompt_and_run`')]);
  const notebook = page.locator('.jp-NotebookPanel:visible .jp-Notebook');
  await runSetup(page);
  let promptRequests = 0;
  page.on('request', item => { if (item.url().endsWith('/nbinlineai/prompt') && item.method() === 'POST') promptRequests++; });
  await notebook.locator('.nbinlineai-prompt-cell [data-nbinlineai-run]').click();
  await expect(notebook.locator('.nbinlineai-prompt-cell')).toHaveCount(2);
  await expect(notebook.locator('.jp-CodeCell').filter({ hasText: 'HANDOFF_P1_RESULT' }).locator('.jp-OutputArea')).toContainText('HANDOFF_P1_RESULT 43');
  expect(promptRequests).toBe(2);
});

test('prompt_and_run visibly stops when its new question does not select code', async ({ page, request }) => {
  await openNotebook(page, request, [setup, ai('ask', 'E2E_HANDOFF_PROMPT_RUN_NO_CHOICE &`prompt_and_run`')]);
  const notebook = page.locator('.jp-NotebookPanel:visible .jp-Notebook');
  await runSetup(page);
  await notebook.locator('.nbinlineai-prompt-cell [data-nbinlineai-run]').click();
  await expect(notebook.locator('.nbinlineai-prompt-cell')).toHaveCount(2);
  await expect(notebook.locator('.nbinlineai-prompt-cell').last().locator('.nbinlineai-status')).toContainText('No code cell was selected');
  await expect(notebook.locator('.jp-CodeCell')).toHaveCount(1);
});

test('direct Python add returns before its inserted code executes', async ({ page, request }) => {
  await openNotebook(page, request, [code('caller',
    'from nbinlineai.tools import add_code_cell_and_execute\nreceipt = add_code_cell_and_execute(content="direct_value = 51\\nprint(\\\"DIRECT_ADD\\\", direct_value)")\nprint("CALLER_RETURNED")')]);
  const notebook = page.locator('.jp-NotebookPanel:visible .jp-Notebook');
  await notebook.locator('.jp-CodeCell').first().click();
  await page.keyboard.press('Shift+Enter');
  await expect(notebook.locator('.jp-CodeCell').first().locator('.jp-OutputArea')).toContainText('CALLER_RETURNED');
  await expect(notebook.locator('.jp-CodeCell').filter({ hasText: 'DIRECT_ADD' }).last().locator('.jp-OutputArea')).toContainText('DIRECT_ADD 51');
});

test('direct Python run_and_prompt transfers the actual output to a new question', async ({ page, request }) => {
  await openNotebook(page, request, [code('caller',
    'from nbinlineai.tools import run_and_prompt\nreceipt = run_and_prompt(prompt="E2E_HANDOFF_RESULT_PROMPT Explain", content="print(\\\"HANDOFF_RESULT\\\", 52)")\nprint("CALLER_RETURNED")')]);
  const notebook = page.locator('.jp-NotebookPanel:visible .jp-Notebook');
  await notebook.locator('.jp-CodeCell').first().click();
  await page.keyboard.press('Shift+Enter');
  await expect(notebook.locator('.jp-CodeCell').filter({ hasText: 'HANDOFF_RESULT' }).last().locator('.jp-OutputArea')).toContainText('HANDOFF_RESULT 52');
  await expect(notebook.locator('.nbinlineai-response-cell')).toContainText('HANDOFF_RESULT 52');
});

test('direct Python prompt_and_run creates a new question with a code choice', async ({ page, request }) => {
  await openNotebook(page, request, [code('caller',
    'from nbinlineai.tools import prompt_and_run\nreceipt = prompt_and_run("E2E_HANDOFF_P1_SELECT Create and execute one code cell.")\nprint("CALLER_RETURNED")')]);
  const notebook = page.locator('.jp-NotebookPanel:visible .jp-Notebook');
  await notebook.locator('.jp-CodeCell').first().click();
  await page.keyboard.press('Shift+Enter');
  await expect(notebook.locator('.nbinlineai-prompt-cell')).toHaveCount(1);
  await expect(notebook.locator('.jp-CodeCell').filter({ hasText: 'HANDOFF_P1_RESULT' }).last().locator('.jp-OutputArea')).toContainText('HANDOFF_P1_RESULT 43');
});
