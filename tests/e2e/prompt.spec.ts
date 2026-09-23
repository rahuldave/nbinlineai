import { expect, test, type Page, type APIRequestContext } from '@playwright/test';

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

type Cell = { id: string; cell_type: 'code' | 'markdown'; source: string; metadata?: object; outputs?: object[]; execution_count?: null };

function code(source: string): Cell {
  return { id: Math.random().toString(36).slice(2, 10), cell_type: 'code', source, metadata: {}, outputs: [], execution_count: null };
}

async function openNotebook(page: Page, request: APIRequestContext, cells: Cell[]) {
  const name = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}.ipynb`;
  const notebook = {
    cells,
    metadata: { kernelspec: { display_name: 'Python 3 (ipykernel)', language: 'python', name: 'python3' } },
    nbformat: 4,
    nbformat_minor: 5
  };
  await request.get('/lab');
  const xsrf = (await request.storageState()).cookies.find(cookie => cookie.name === '_xsrf')?.value;
  expect(xsrf).toBeTruthy();
  const response = await request.put(`/api/contents/${name}`, {
    headers: { 'X-XSRFToken': xsrf! },
    data: { type: 'notebook', format: 'json', content: notebook }
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  await page.goto(`/lab/workspaces/${name.slice(0, -6)}/tree/${name}`);
  await expect(page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-Cell')).toHaveCount(cells.length);
  return name;
}

async function insertPrompt(page: Page, afterCell: number, prompt: string) {
  await page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-Cell').nth(afterCell).click();
  await page.getByRole('button', { name: 'AI Prompt' }).click();
  const cell = page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-Cell.nbinlineai-prompt-cell').last();
  await expect(cell).toBeVisible();
  await cell.locator('.cm-content').fill(prompt);
  return cell;
}

async function runPrompt(page: Page) {
  await page.keyboard.press('Shift+Enter');
  await expect(page.locator('.nbinlineai-status').last()).toContainText(/done|complete|ready/i);
}

test('prompt executes in the notebook, streams a reply, and reuses its saved pair', async ({ page, request }) => {
  const name = await openNotebook(page, request, [code('2 + 2')]);
  const prompt = await insertPrompt(page, 0, 'E2E_BASIC explain the cell above');
  await runPrompt(page);
  const answer = page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-Cell.nbinlineai-response-cell');
  await expect(answer).toHaveCount(1);
  await expect(answer).toContainText('E2E provider=openai_api');
  await expect(answer).toContainText('2 + 2');
  await expect(answer.locator('.jp-RenderedHTMLCommon')).toContainText('E2E provider=openai_api');
  await page.screenshot({ path: 'test-results/nbinlineai-mvp.png', fullPage: true });

  await prompt.locator('button[data-nbinlineai-run]').click();
  await expect(answer).toHaveCount(1);
  await expect(answer).toContainText('E2E provider=openai_api');
  await expect(answer.locator('.jp-RenderedHTMLCommon')).toContainText('E2E provider=openai_api');

  await page.keyboard.press('Meta+s');
  await expect(page.getByText('Saving completed')).toBeVisible();
  let body: any;
  await expect.poll(async () => {
    const saved = await request.get(`/api/contents/${name}?content=1`);
    if (!saved.ok()) return false;
    body = await saved.json();
    return Array.isArray(body.content?.cells);
  }).toBeTruthy();
  const promptCells = body.content.cells.filter((cell: any) => cell.metadata?.nbinlineai?.isPromptCell);
  const answerCells = body.content.cells.filter((cell: any) => cell.metadata?.nbinlineai?.promptCellId);
  expect(promptCells).toHaveLength(1);
  expect(answerCells).toHaveLength(1);

  await page.reload();
  await expect(page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-Cell.nbinlineai-prompt-cell')).toHaveCount(1);
  await expect(page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-Cell.nbinlineai-response-cell')).toHaveCount(1);
});

test('context stops at prompt and live variable comes from the running kernel', async ({ page, request }) => {
  await openNotebook(page, request, [code('x = 7 # ABOVE_MARKER'), code('print("BELOW_MARKER")')]);
  await page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-Cell').first().click();
  await page.keyboard.press('Shift+Enter');
  await expect(page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-CodeCell').first().locator('.jp-InputPrompt')).toContainText('1');
  await page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-Cell').first().locator('.cm-content').fill('x = 999 # ABOVE_MARKER');
  const prompt = await insertPrompt(page, 0, 'E2E_CONTEXT inspect $`x`');
  await runPrompt(page);
  const answer = page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-Cell.nbinlineai-response-cell');
  await expect(answer).toContainText('ABOVE_MARKER');
  await expect(answer).not.toContainText('BELOW_MARKER');
  await expect(answer).toContainText('x = 999');
  await expect(answer).toContainText('E2E_CONTEXT inspect 7');
  await expect(prompt.locator('.nbinlineai-status')).toContainText(/done|complete|ready/i);
});

test('provider selection is sent with the prompt and ordinary code still runs', async ({ page, request }) => {
  await openNotebook(page, request, [code('print("ordinary code works")')]);
  await page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-Cell').first().click();
  await page.keyboard.press('Shift+Enter');
  await expect(page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-Cell').first()).toContainText('ordinary code works');
  const prompt = await insertPrompt(page, 0, 'E2E_PROVIDER');
  await prompt.locator('select[data-nbinlineai-provider]').selectOption('anthropic_api');
  await prompt.locator('button[data-nbinlineai-run]').click();
  await expect(page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-Cell.nbinlineai-response-cell')).toContainText('E2E provider=anthropic_api');
});

test('registered function tool changes the live Python kernel', async ({ page, request }) => {
  await openNotebook(page, request, [
    code('counter = 0\ndef bump(value: int):\n    global counter\n    counter += value\n    return counter'),
    code('print(counter)')
  ]);
  const definition = page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-CodeCell').first();
  await definition.click();
  await page.keyboard.press('Shift+Enter');
  await expect(definition.locator('.jp-InputPrompt')).toContainText('1');
  const prompt = await insertPrompt(page, 0, 'E2E_TOOL call &`bump` once');
  await prompt.locator('button[data-nbinlineai-run]').click();
  const answer = page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-Cell.nbinlineai-response-cell');
  await expect(answer).toContainText('E2E provider=openai_api');
  await expect(answer.locator('.jp-RenderedHTMLCommon')).toContainText('E2E provider=openai_api');
  await expect(prompt.locator('.nbinlineai-status')).toContainText('Done');
  const inspection = page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-CodeCell').nth(1);
  await inspection.click();
  await page.keyboard.press('Shift+Enter');
  await expect(inspection.locator('.jp-OutputArea')).toContainText('4');
  await page.screenshot({ path: 'test-results/nbinlineai-mvp-tool.png', fullPage: true });
});

test('provider error and cancellation surface without duplicating answer cells', async ({ page, request }) => {
  await openNotebook(page, request, [code('pass')]);
  const prompt = await insertPrompt(page, 0, 'E2E_ERROR');
  await prompt.locator('button[data-nbinlineai-run]').click();
  await expect(prompt.locator('.nbinlineai-status')).toContainText(/error|fail/i);
  expect(await page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-Cell.nbinlineai-response-cell').count()).toBeLessThanOrEqual(1);

  await prompt.locator('.cm-content').fill('E2E_SLOW');
  await prompt.locator('button[data-nbinlineai-run]').click();
  await expect(prompt.locator('button[data-nbinlineai-cancel]')).toBeEnabled();
  await prompt.locator('button[data-nbinlineai-cancel]').click();
  await expect(prompt.locator('.nbinlineai-status')).toContainText(/cancel|stopp?ed/i);
});
