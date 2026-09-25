import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

type Cell = { id: string; cell_type: 'code' | 'markdown'; source: string; metadata: object;
  outputs?: object[]; execution_count?: number | null };
const code = (id: string, source: string, outputs: object[] = [], execution_count: number | null = null): Cell =>
  ({ id, cell_type: 'code', source, metadata: {}, outputs, execution_count });
const prompt = (id: string, source: string): Cell =>
  ({ id, cell_type: 'markdown', source, metadata: { nbinlineai: { isPromptCell: true } } });

async function openNotebook(page: Page, request: APIRequestContext, cells: Cell[]): Promise<string> {
  const name = `cell-edit-${Date.now()}-${Math.floor(Math.random() * 1e6)}.ipynb`;
  await request.get('/lab');
  const xsrf = (await request.storageState()).cookies.find(cookie => cookie.name === '_xsrf')?.value;
  expect(xsrf).toBeTruthy();
  const created = await request.put(`/api/contents/${name}`, {
    headers: { 'X-XSRFToken': xsrf! },
    data: { type: 'notebook', format: 'json', content: {
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
  return name;
}

async function setup(page: Page): Promise<void> {
  const first = page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-CodeCell').first();
  await first.click();
  await page.keyboard.press('Shift+Enter');
  await expect(first.locator('.jp-InputPrompt')).toContainText('[1]');
}

async function run(page: Page): Promise<string> {
  const question = page.locator('.jp-NotebookPanel:visible .nbinlineai-prompt-cell').first();
  await question.locator('[data-nbinlineai-run]').click();
  await expect(question.locator('.nbinlineai-status')).toContainText(/Done|Answer kept/);
  const answer = page.locator('.jp-NotebookPanel:visible .nbinlineai-response-cell').first();
  await expect(answer).toContainText('CELL_EDIT_DONE');
  return (await answer.innerText()) || '';
}

async function savedCells(request: APIRequestContext, name: string): Promise<any[]> {
  const response = await request.get(`/api/contents/${name}?content=1`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()).content.cells;
}

async function saveNotebook(page: Page, name: string): Promise<void> {
  // Reading Contents while Jupyter writes the file can see an empty notebook.
  const saved = page.waitForResponse(response =>
    new URL(response.url()).pathname === `/api/contents/${name}` &&
    response.request().method() === 'PUT');
  await page.keyboard.press('ControlOrMeta+s');
  const response = await saved;
  expect(response.ok(), await response.text()).toBeTruthy();
}

test.beforeEach(async ({ request }) => {
  await request.get('/lab');
  const xsrf = (await request.storageState()).cookies.find(cookie => cookie.name === '_xsrf')?.value;
  expect(xsrf).toBeTruthy();
  const saved = await request.post('/nbinlineai/settings/keys', {
    headers: { 'X-XSRFToken': xsrf! }, data: { backend: 'openai_api', key: 'e2e-no-network-openai' }
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();
});

test('searches unsaved source, clears stale code output and rejects stale or AI edits', async ({ page, request }) => {
  const name = await openNotebook(page, request, [
    code('setup', 'from nbinlineai.tools import find_cells, replace_cell'),
    prompt('ask', 'E2E_CELL_EDIT_SOURCE &`find_cells` &`replace_cell`'),
    code('target', 'OLD_SAVED_MARKER = 1', [{ output_type: 'stream', name: 'stdout', text: 'old result\n' }], 7)
  ]);
  await setup(page);
  const target = page.locator('.jp-NotebookPanel:visible .jp-CodeCell').last();
  await target.locator('.cm-content').fill('UNSAVED_MARKER = 10');
  const response = await run(page);
  expect(response).toContain('UNSAVED_MARKER');
  expect(response).toContain('Cell source changed');
  expect(response).toContain('AI question and answer cells are protected');
  await expect(target.locator('.cm-content')).toContainText('UNSAVED_MARKER = 11');
  await expect(target.locator('.jp-OutputArea-output')).toHaveCount(0);
  expect((await savedCells(request, name)).find(cell => cell.id === 'target').source).toBe('OLD_SAVED_MARKER = 1');
  await saveNotebook(page, name);
  await expect.poll(async () => (await savedCells(request, name)).find(cell => cell.id === 'target'))
    .toMatchObject({ source: 'UNSAVED_MARKER = 11', execution_count: null, outputs: [] });
  await page.reload();
  await expect(page.locator('.jp-NotebookPanel:visible .jp-CodeCell').last().locator('.cm-content'))
    .toContainText('UNSAVED_MARKER = 11');
});

test('split, merge, copy, move and delete change only ordinary live cells, and Keep avoids repeating effects', async ({ page, request }) => {
  const name = await openNotebook(page, request, [
    code('setup', 'from nbinlineai.tools import split_cell, merge_cells, copy_cell, move_cell, delete_cell'),
    prompt('ask', 'E2E_CELL_EDIT_STRUCTURE &`split_cell` &`merge_cells` &`copy_cell` &`move_cell` &`delete_cell`'),
    code('a', 'alpha\nbeta'), code('b', 'bravo'), code('c', 'charlie'), code('d', 'delta'), code('e', 'erase me')
  ]);
  await setup(page);
  let posts = 0;
  page.on('request', item => { if (item.url().endsWith('/nbinlineai/prompt') && item.method() === 'POST') posts++; });
  const response = await run(page);
  expect(response).toContain('Split cell a');
  expect(response).toContain('Merged cells into b');
  expect(response).toContain('Copied cell as');
  expect(response).toContain('Moved cell d');
  expect(response).toContain('Deleted cell e');
  expect(posts).toBe(1);
  const getLive = () => page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-Cell').evaluateAll(elements =>
    elements.map(element => ({ id: element.getAttribute('data-cell-id'), text: element.textContent || '' })));
  const beforeKeep = await getLive();
  const question = page.locator('.jp-NotebookPanel:visible .nbinlineai-prompt-cell').first();
  await question.click();
  await page.keyboard.press('Shift+Enter');
  await expect(question.locator('.nbinlineai-status')).toContainText(/Answer kept|Done/);
  expect(posts).toBe(1);
  expect(await getLive()).toEqual(beforeKeep);
  await saveNotebook(page, name);
  await expect.poll(async () => {
    const cells = await savedCells(request, name);
    const ordinary = cells.filter(cell => ['a', 'b', 'c', 'd', 'e'].includes(cell.id) ||
      (cell.cell_type === 'code' && cell.source === 'beta') ||
      (cell.cell_type === 'code' && cell.source === 'bravo\ncharlie'));
    return ordinary.map(cell => cell.source).join('|');
  }).toContain('alpha|delta|beta|bravo\ncharlie');
  const persisted = await savedCells(request, name);
  expect(persisted.some(cell => cell.id === 'c' || cell.id === 'e')).toBe(false);
  expect(persisted.filter(cell => cell.source === 'bravo\ncharlie')).toHaveLength(2);
});

test('line insert, range replacement and literal replacement use current source', async ({ page, request }) => {
  const name = await openNotebook(page, request, [
    code('setup', 'from nbinlineai.tools import cell_insert_line, cell_replace_lines, cell_str_replace'),
    prompt('ask', 'E2E_CELL_EDIT_LINES &`cell_insert_line` &`cell_replace_lines` &`cell_str_replace`'),
    code('target', 'first\nlast')
  ]);
  await setup(page);
  const response = await run(page);
  expect(response).toContain('Updated cell target');
  await expect(page.locator('.jp-NotebookPanel:visible .jp-CodeCell').last().locator('.cm-line'))
    .toHaveText(['first', 'replaced', 'tail']);
  await saveNotebook(page, name);
  await expect.poll(async () => (await savedCells(request, name)).find(cell => cell.id === 'target')?.source)
    .toBe('first\nreplaced\ntail');
});
