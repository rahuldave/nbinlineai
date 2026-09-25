import { expect, test, type APIRequestContext, type Page } from '../support/e2e-fixtures';

type Cell = { id: string; cell_type: 'code' | 'markdown'; source: string; metadata: object; outputs?: object[]; execution_count?: null };
const code = (id: string, source: string): Cell => ({ id, cell_type: 'code', source, metadata: {}, outputs: [], execution_count: null });
const prompt = (id: string, source: string): Cell => ({ id, cell_type: 'markdown', source, metadata: { nbinlineai: { isPromptCell: true } } });

async function openNotebook(page: Page, request: APIRequestContext, cells: Cell[]): Promise<string> {
  const name = `bridge-${Date.now()}-${Math.floor(Math.random() * 1e6)}.ipynb`;
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

async function captureNotebookCells(page: Page, filename: string): Promise<void> {
  await page.setViewportSize({ width: 1500, height: 1100 });
  const newsNo = page.getByRole('button', { name: 'No', exact: true });
  if (await newsNo.isVisible().catch(() => false)) await newsNo.click();
  const cells = page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-Cell');
  const boxes = (await Promise.all(Array.from({ length: await cells.count() }, (_, i) => cells.nth(i).boundingBox())))
    .filter((box): box is NonNullable<typeof box> => box !== null);
  expect(boxes.length).toBeGreaterThan(0);
  const x = Math.max(0, Math.min(...boxes.map(box => box.x)) - 12);
  const y = Math.max(0, Math.min(...boxes.map(box => box.y)) - 12);
  const right = Math.min(1500, Math.max(...boxes.map(box => box.x + box.width)) + 12);
  const bottom = Math.min(1100, Math.max(...boxes.map(box => box.y + box.height)) + 12);
  await page.screenshot({ path: `docs/images/${filename}`, clip: {
    x, y, width: right - x, height: bottom - y
  } });
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

test('read_cell uses current unsaved source below the AI prompt', async ({ page, request }) => {
  const name = await openNotebook(page, request, [
    code('setup', 'from nbinlineai.tools import read_cell'),
    prompt('ask', 'E2E_BRIDGE_READ &`read_cell`'),
    code('live-later', 'OLD_SAVED_VALUE = 1')
  ]);
  const notebook = page.locator('.jp-NotebookPanel:visible .jp-Notebook');
  await notebook.locator('.jp-Cell').first().click();
  await page.keyboard.press('Shift+Enter');
  await expect(notebook.locator('.jp-CodeCell').first().locator('.jp-InputPrompt')).toContainText('[1]');
  await notebook.locator('.jp-Cell').last().locator('.cm-content').fill('UNSAVED_LIVE_MARKER = 74');
  await notebook.locator('.nbinlineai-prompt-cell [data-nbinlineai-run]').click();
  await expect(notebook.locator('.nbinlineai-response-cell')).toContainText('UNSAVED_LIVE_MARKER = 74');
  const stored = await (await request.get(`/api/contents/${name}?content=1`)).json();
  expect(JSON.stringify(stored.content.cells)).toContain('OLD_SAVED_VALUE = 1');
});

test('duplicate frontend_action inserts one ordinary Markdown note after its paired answer', async ({ page, request }) => {
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await original(...args);
      if (!String(args[0]).includes('/nbinlineai/prompt') || !response.body) return response;
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      let buffer = '';
      let duplicated = false;
      const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          buffer += decoder.decode(chunk, { stream: true });
          let end = buffer.indexOf('\n\n');
          while (end >= 0) {
            const frame = buffer.slice(0, end + 2);
            buffer = buffer.slice(end + 2);
            controller.enqueue(encoder.encode(frame));
            if (!duplicated && frame.includes('"type": "frontend_action"')) {
              duplicated = true;
              controller.enqueue(encoder.encode(frame));
            }
            end = buffer.indexOf('\n\n');
          }
        },
        flush(controller) { if (buffer) controller.enqueue(encoder.encode(buffer)); }
      }));
      return new Response(body, { status: response.status, headers: response.headers });
    };
  });
  const name = await openNotebook(page, request, [
    code('setup', 'from nbinlineai.tools import insert_markdown'),
    prompt('ask', 'Add a short study note about live notebook context using &`insert_markdown`.'),
    code('later', 'next_step = "review the note"')
  ]);
  const notebook = page.locator('.jp-NotebookPanel:visible .jp-Notebook');
  await notebook.locator('.jp-Cell').first().click();
  await page.keyboard.press('Shift+Enter');
  await expect(notebook.locator('.jp-CodeCell').first().locator('.jp-InputPrompt')).toContainText('[1]');
  await notebook.locator('.nbinlineai-prompt-cell [data-nbinlineai-run]').click();
  await expect(notebook.locator('.nbinlineai-response-cell')).toContainText('editable Markdown note below this answer');
  await expect(notebook.locator('.jp-Cell').filter({ hasText: 'Live notebook note' })).toHaveCount(1);
  const order = await notebook.locator('.jp-Cell').evaluateAll(cells => cells.map(cell => cell.textContent || ''));
  expect(order.findIndex(text => text.includes('Live notebook note'))).toBe(order.findIndex(text => text.includes('editable Markdown note below this answer')) + 1);
  expect(order.findIndex(text => text.includes('Live notebook note'))).toBeLessThan(order.findIndex(text => text.includes('next_step')));
  await page.keyboard.press('ControlOrMeta+s');
  await expect.poll(async () => {
    const saved = await request.get(`/api/contents/${name}?content=1`);
    if (!saved.ok()) return false;
    const body = await saved.json();
    const note = body.content.cells.find((cell: any) => String(cell.source).includes('Live notebook note'));
    return note?.cell_type === 'markdown' && !note.metadata?.nbinlineai;
  }).toBeTruthy();
  await captureNotebookCells(page, 'live-notebook-tools.png');
});

test('a missing live cell returns a tool error without inserting a note', async ({ page, request }) => {
  await openNotebook(page, request, [
    code('setup', 'from nbinlineai.tools import read_cell'),
    prompt('ask', 'E2E_BRIDGE_MISSING &`read_cell`')
  ]);
  const notebook = page.locator('.jp-NotebookPanel:visible .jp-Notebook');
  await notebook.locator('.jp-Cell').first().click();
  await page.keyboard.press('Shift+Enter');
  await expect(notebook.locator('.jp-CodeCell').first().locator('.jp-InputPrompt')).toContainText('[1]');
  await notebook.locator('.nbinlineai-prompt-cell [data-nbinlineai-run]').click();
  await expect(notebook.locator('.nbinlineai-response-cell')).toContainText('Error: Cell was removed');
  await expect(notebook.locator('.jp-Cell')).toHaveCount(3);
});

test('url_to_note adds a source-attributed Markdown note in the same live notebook', async ({ page, request }) => {
  await openNotebook(page, request, [
    code('setup', 'from nbinlineai.tools import url_to_note'),
    prompt('ask', 'Add the public study page as a notebook note using &`url_to_note`: https://example.org/study-lesson')
  ]);
  const notebook = page.locator('.jp-NotebookPanel:visible .jp-Notebook');
  await notebook.locator('.jp-Cell').first().click();
  await page.keyboard.press('Shift+Enter');
  await expect(notebook.locator('.jp-CodeCell').first().locator('.jp-InputPrompt')).toContainText('[1]');
  await notebook.locator('.nbinlineai-prompt-cell [data-nbinlineai-run]').click();
  await expect(notebook.locator('.nbinlineai-response-cell')).toContainText('source-attributed study note');
  await expect(notebook).toContainText('Source: https://example.org/study-lesson');
  await expect(notebook).toContainText('Compare each claim with its supporting evidence');
  await captureNotebookCells(page, 'web-tools.png');
});

test('a delayed note remains bound to its originating notebook after focus switches', async ({ page, request }) => {
  const first = await openNotebook(page, request, [
    code('setup', 'from nbinlineai.tools import insert_markdown'),
    prompt('ask', 'E2E_BRIDGE_INSERT E2E_BRIDGE_DELAY &`insert_markdown`')
  ]);
  const xsrf = (await request.storageState()).cookies.find(cookie => cookie.name === '_xsrf')?.value;
  const second = `bridge-other-${Date.now()}.ipynb`;
  const created = await request.put(`/api/contents/${second}`, {
    headers: { 'X-XSRFToken': xsrf! },
    data: { type: 'notebook', format: 'json', content: {
      cells: [code('other', 'OTHER_NOTEBOOK = True')],
      metadata: { kernelspec: { display_name: 'Python 3 (ipykernel)', language: 'python', name: 'python3' } },
      nbformat: 4, nbformat_minor: 5
    } }
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const firstNotebook = page.locator('.jp-NotebookPanel:visible .jp-Notebook');
  await firstNotebook.locator('.jp-Cell').first().click();
  await page.keyboard.press('Shift+Enter');
  await expect(firstNotebook.locator('.jp-CodeCell').first().locator('.jp-InputPrompt')).toContainText('[1]');
  await firstNotebook.locator('.nbinlineai-prompt-cell [data-nbinlineai-run]').click();
  await page.locator('.jp-FileBrowser .jp-DirListing-itemText').filter({ hasText: second }).dblclick();
  await expect(page.locator('.jp-NotebookPanel:visible .jp-Notebook')).toContainText('OTHER_NOTEBOOK = True');
  await expect(page.locator('.jp-NotebookPanel:visible .jp-Notebook')).not.toContainText('E2E_INSERTED_NOTE');
  await page.getByRole('tab', { name: first, exact: true }).click();
  await expect(page.locator('.jp-NotebookPanel:visible .jp-Notebook')).toContainText('E2E_INSERTED_NOTE in the originating notebook');
  await page.getByRole('tab', { name: second, exact: true }).click();
  await expect(page.locator('.jp-NotebookPanel:visible .jp-Notebook')).not.toContainText('E2E_INSERTED_NOTE');
});

test('cancelling before a delayed action leaves the notebook unchanged', async ({ page, request }) => {
  await openNotebook(page, request, [
    code('setup', 'from nbinlineai.tools import insert_markdown'),
    prompt('ask', 'E2E_BRIDGE_INSERT E2E_BRIDGE_DELAY &`insert_markdown`')
  ]);
  const notebook = page.locator('.jp-NotebookPanel:visible .jp-Notebook');
  await notebook.locator('.jp-Cell').first().click();
  await page.keyboard.press('Shift+Enter');
  await expect(notebook.locator('.jp-CodeCell').first().locator('.jp-InputPrompt')).toContainText('[1]');
  const ai = notebook.locator('.nbinlineai-prompt-cell');
  await ai.locator('[data-nbinlineai-run]').click();
  await expect(ai.locator('.nbinlineai-status')).toHaveAttribute('data-state', 'running');
  await ai.locator('[data-nbinlineai-cancel]').click();
  await expect(ai.locator('.nbinlineai-status')).toContainText(/Cancel/);
  await expect(notebook.locator('.jp-Cell')).toHaveCount(3);
  await expect(notebook).not.toContainText('E2E_INSERTED_NOTE');
});

test('insert_code adds one unexecuted ordinary cell after the AI answer during Run All', async ({ page, request }) => {
  const name = await openNotebook(page, request, [
    code('setup', 'from nbinlineai.tools import insert_code'),
    prompt('ask', 'E2E_BRIDGE_CODE use &`insert_code` to suggest a code cell'),
    code('later', 'print("EXISTING_LATER_CODE_RAN")')
  ]);
  const notebook = page.locator('.jp-NotebookPanel:visible .jp-Notebook');
  let requests = 0;
  page.on('request', item => {
    if (item.url().endsWith('/nbinlineai/prompt') && item.method() === 'POST') requests++;
  });
  await page.locator('.lm-MenuBar-item').filter({ hasText: /^Run$/ }).click();
  await page.getByRole('menuitem', { name: 'Run All Cells', exact: true }).click();
  await expect(notebook.locator('.jp-CodeCell').last().locator('.jp-OutputArea')).toContainText('EXISTING_LATER_CODE_RAN');
  await expect(notebook.locator('.nbinlineai-response-cell')).toContainText('without running it');
  const inserted = notebook.locator('.jp-CodeCell').filter({ hasText: 'new_code_ran = True' });
  await expect(inserted).toHaveCount(1);
  await expect(inserted.locator('.jp-OutputArea-output')).toHaveCount(0);
  expect(requests).toBe(1);
  const order = await notebook.locator('.jp-Cell').evaluateAll(cells => cells.map(cell => cell.textContent || ''));
  expect(order.findIndex(text => text.includes('new_code_ran = True'))).toBe(order.findIndex(text => text.includes('without running it')) + 1);
  await page.keyboard.press('ControlOrMeta+s');
  await expect.poll(async () => {
    const saved = await request.get(`/api/contents/${name}?content=1`);
    if (!saved.ok()) return false;
    const body = await saved.json();
    const cell = body.content.cells.find((item: any) => String(item.source).includes('new_code_ran = True'));
    return cell?.cell_type === 'code' && cell.execution_count === null &&
      cell.outputs?.length === 0 && !cell.metadata?.nbinlineai;
  }).toBeTruthy();
  await page.reload();
  await expect(page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-CodeCell').filter({ hasText: 'new_code_ran = True' })).toHaveCount(1);
});
