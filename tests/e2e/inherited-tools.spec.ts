import { expect, test, type APIRequestContext, type Page } from '../support/e2e-fixtures';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Cell = {
  id: string;
  cell_type: 'code' | 'markdown' | 'raw';
  source: string;
  metadata: Record<string, unknown>;
  outputs?: object[];
  execution_count?: null;
};

function code(id: string, source: string): Cell {
  return { id, cell_type: 'code', source, metadata: {}, outputs: [], execution_count: null };
}

function note(id: string, source: string): Cell {
  return { id, cell_type: 'markdown', source, metadata: {} };
}

function raw(id: string, source: string): Cell {
  return { id, cell_type: 'raw', source, metadata: {} };
}

function question(id: string, source: string): Cell {
  return { id, cell_type: 'markdown', source, metadata: { nbinlineai: { isPromptCell: true } } };
}

async function putNotebook(request: APIRequestContext, cells: Cell[]): Promise<string> {
  const name = `inherited-tools-${Date.now()}-${Math.floor(Math.random() * 1e6)}.ipynb`;
  await request.get('/lab');
  const xsrf = (await request.storageState()).cookies.find(cookie => cookie.name === '_xsrf')?.value;
  expect(xsrf).toBeTruthy();
  const response = await request.put(`/api/contents/${name}`, {
    headers: { 'X-XSRFToken': xsrf! },
    data: {
      type: 'notebook', format: 'json',
      content: {
        cells,
        metadata: { kernelspec: { display_name: 'Python 3 (ipykernel)', language: 'python', name: 'python3' } },
        nbformat: 4, nbformat_minor: 5
      }
    }
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return name;
}

async function openNotebook(page: Page, request: APIRequestContext, cells: Cell[]): Promise<string> {
  const name = await putNotebook(request, cells);
  await page.goto(`/lab/workspaces/${name.slice(0, -6)}/tree/${name}`);
  await expect(page.locator('.jp-NotebookPanel:visible')).toBeVisible();
  await expect.poll(async () => {
    const sessions = await request.get('/api/sessions');
    if (!sessions.ok()) return false;
    return (await sessions.json()).some((session: any) => session.path === name && session.kernel?.id);
  }).toBeTruthy();
  return name;
}

async function executeSetup(page: Page): Promise<void> {
  const setup = page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-CodeCell').first();
  await setup.click();
  await page.keyboard.press('Shift+Enter');
  await expect(setup.locator('.jp-InputPrompt')).toContainText('1');
}

async function runQuestion(page: Page, index: number): Promise<string> {
  const cell = page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-Cell.nbinlineai-prompt-cell').nth(index);
  await expect(cell).toBeVisible();
  await cell.locator('[data-nbinlineai-run]').click();
  await expect(cell.locator('.nbinlineai-status')).toContainText(/Done|Answer kept/);
  const next = cell.locator('xpath=following-sibling::*[contains(@class,"nbinlineai-response-cell")][1]');
  return (await next.innerText()) || '';
}

async function configureFakeKey(request: APIRequestContext): Promise<void> {
  await request.get('/lab');
  const xsrf = (await request.storageState()).cookies.find(cookie => cookie.name === '_xsrf')?.value;
  expect(xsrf).toBeTruthy();
  const response = await request.post('/nbinlineai/settings/keys', {
    headers: { 'X-XSRFToken': xsrf! },
    data: { backend: 'openai_api', key: 'e2e-no-network-openai' }
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

async function runAllFromMenu(page: Page): Promise<void> {
  await page.locator('.lm-MenuBar-item').filter({ hasText: /^Run$/ }).click();
  await page.getByRole('menuitem', { name: 'Run All Cells', exact: true }).click();
}

test.beforeEach(async ({ request }) => { await configureFakeKey(request); });

test('shipped notebook declares a stateful tool once for a natural lower question', async ({ page, request }) => {
  const example = JSON.parse(readFileSync(resolve('examples/live-variables-and-tools.ipynb'), 'utf8'));
  await openNotebook(page, request, example.cells as Cell[]);
  await page.setViewportSize({ width: 1450, height: 1050 });
  await executeSetup(page);
  const answer = await runQuestion(page, 0);
  expect(answer).toContain('Result: 4');
  const notebook = page.locator('.jp-NotebookPanel:visible .jp-Notebook');
  const declaration = notebook.locator('.jp-MarkdownCell').filter({ hasText: 'Tools offered to the questions below' });
  const prompt = notebook.locator('.nbinlineai-prompt-cell').first();
  const response = notebook.locator('.nbinlineai-response-cell').first();
  await declaration.scrollIntoViewIfNeeded();
  const boxes = await Promise.all([declaration, prompt, response].map(locator => locator.boundingBox()));
  expect(boxes.every(Boolean)).toBe(true);
  const visible = boxes.filter(box => box !== null);
  const left = Math.max(0, Math.min(...visible.map(box => box.x)) - 15);
  const top = Math.max(0, Math.min(...visible.map(box => box.y)) - 2);
  const right = Math.min(1450, Math.max(...visible.map(box => box.x + box.width)) + 15);
  const bottom = Math.min(1050, Math.max(...visible.map(box => box.y + box.height)) + 2);
  expect(bottom - top).toBeGreaterThan(100);
  await page.screenshot({ path: 'docs/images/inherited-tools.png', clip: {
    x: left, y: top, width: right - left, height: bottom - top
  } });
});

test('ordinary Markdown declaration is inherited by two later questions and calls a live stateful tool', async ({ page, request }) => {
  await openNotebook(page, request, [
    code('setup', 'counter = 0\ndef bump(value: int) -> int:\n    global counter\n    counter += value\n    return counter'),
    note('tools', '## Tools for the questions below\n\n- &`bump` — add to the live counter.'),
    question('first', 'E2E_INHERIT_CALL_BUMP Call the declared bump function once.'),
    question('second', 'E2E_INHERIT_CALL_BUMP Call the declared bump function once more.'),
    code('inspect', 'print(counter)')
  ]);
  await executeSetup(page);
  const streamed = page.waitForResponse(response => response.url().endsWith('/nbinlineai/prompt') && response.request().method() === 'POST');
  expect(await runQuestion(page, 0)).toContain('Result: 4');
  const events = (await (await streamed).text()).split('\n')
    .filter(line => line.startsWith('data: '))
    .map(line => JSON.parse(line.slice(6)));
  const contexts = events.filter(event => event.type === 'context');
  expect(contexts).toHaveLength(2);
  expect(contexts.map(event => event.tools)).toEqual([['bump'], ['bump']]);
  expect(contexts.every(event => event.context_budget_chars === 64000 && event.tool_schema_chars > 0)).toBeTruthy();
  expect(contexts[1].context_chars).toBeGreaterThanOrEqual(contexts[0].context_chars);
  expect(await runQuestion(page, 1)).toContain('Result: 8');
  const inspection = page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-CodeCell').nth(1);
  await inspection.locator('.cm-content').click();
  await page.keyboard.press('Shift+Enter');
  await expect(inspection.locator('.jp-OutputArea')).toContainText('8');
});

test('an earlier AI question declares a tool, but answer, code, and raw cells cannot', async ({ page, request }) => {
  await openNotebook(page, request, [
    code('setup', 'counter = 0\ndef bump(value: int) -> int:\n    global counter\n    counter += value\n    return counter\n# &`code_only` CODE_ONLY_DECLARATION'),
    raw('raw-reference', '&`raw_only`'),
    question('earlier-question', 'This question declares &`bump` for later questions.'),
    {
      ...note('earlier-answer', 'ANSWER_ONLY_DECLARATION &`answer_only`'),
      metadata: { nbinlineai: { isOutputCell: true, promptCellId: 'earlier-question', status: 'done' } }
    },
    question('lower-question', 'E2E_INHERIT_CALL_BUMP Call the declared bump function once.'),
    question('inspect-question', 'E2E_INHERIT_INSPECT List the tool schemas available now.')
  ]);
  await executeSetup(page);
  expect(await runQuestion(page, 1)).toContain('Result: 4');
  const report = await runQuestion(page, 2);
  expect(report.match(/INHERITED_SCHEMAS=([^;]*)/)?.[1]?.trim()).toBe('bump');
  expect(report).toContain('ANSWER_ONLY_SOURCE=False');
});

test('oldest declaration survives more than 200 cells while prose trims from the far end', async ({ page, request }) => {
  const cells: Cell[] = [
    code('setup', 'counter = 0\ndef bump(value: int) -> int:\n    global counter\n    counter += value\n    return counter'),
    note('old-declaration', 'OLD_SOURCE_SHOULD_TRIM\n\n&`bump` — live counter tool.')
  ];
  for (let index = 0; index < 215; index++) {
    cells.push(note(`filler-${index}`, `Filler ${index}: ${'ordinary notebook prose '.repeat(35)}`));
  }
  cells.push(note('nearby', 'NEAREST_SOURCE_INCLUDED: summarize the most recent observation.'));
  cells.push(question('inspection', 'E2E_INHERIT_INSPECT Report the available tool schemas and context flags.'));
  await openNotebook(page, request, cells);
  await executeSetup(page);
  const report = await runQuestion(page, 0);
  expect(report).toContain('INHERITED_SCHEMAS=bump');
  expect(report).toContain('OLD_SOURCE=False');
  expect(report).toContain('NEAR_SOURCE=True');
});

test('current question alone expands dollar references and repeated ampersand declarations deduplicate', async ({ page, request }) => {
  await openNotebook(page, request, [
    code('setup', 'x = 7\ndef bump(value: int) -> int:\n    return value'),
    note('tools', 'Tools: &`bump` &`bump`. Earlier value reference: $`x`.'),
    question('first', 'E2E_INHERIT_INSPECT No live value reference in this question.'),
    question('second', 'E2E_INHERIT_INSPECT Current live value is $`x`.')
  ]);
  await executeSetup(page);
  const first = await runQuestion(page, 0);
  expect(first).toContain('INHERITED_SCHEMAS=bump');
  expect(first).toContain('CURRENT_QUESTION=E2E_INHERIT_INSPECT No live value reference in this question.');
  const second = await runQuestion(page, 1);
  expect(second).toContain('Current live value is 7.');
});

test('insert_tools binds the executing code cell despite focus movement and persists one selected custom declaration', async ({ page, request }) => {
  const name = await openNotebook(page, request, [
    code('setup', 'counter = 0\ndef bump(value: int) -> int:\n    global counter\n    counter += value\n    return counter\nbump_alias = bump'),
    code('helper', 'import time\ntime.sleep(0.5)\nfrom nbinlineai.tools import insert_tools\nreceipt = insert_tools(["bump_alias"], custom={"bump_alias": bump_alias})\nreceipt'),
    question('lower-question', 'E2E_INHERIT_CALL_ALIAS Use the declared bump_alias tool once.'),
    code('later', 'print(counter)')
  ]);
  await executeSetup(page);
  const notebook = page.locator('.jp-NotebookPanel:visible .jp-Notebook');
  let promptPosts = 0;
  page.on('request', item => {
    if (item.url().endsWith('/nbinlineai/prompt') && item.method() === 'POST') promptPosts += 1;
  });
  const helper = notebook.locator('.jp-CodeCell').nth(1);
  await helper.click();
  await page.keyboard.press('Shift+Enter');
  await notebook.locator('.jp-CodeCell').last().click();
  const declaration = notebook.locator('.jp-MarkdownCell:not(.nbinlineai-prompt-cell):not(.nbinlineai-response-cell)')
    .filter({ hasText: 'bump_alias' });
  await expect(declaration).toHaveCount(1);
  expect(promptPosts).toBe(0);
  expect(await runQuestion(page, 0)).toContain('Result: 4');
  expect(promptPosts).toBe(1);

  await page.keyboard.press('ControlOrMeta+s');
  await expect.poll(async () => {
    const response = await request.get(`/api/contents/${name}?content=1`);
    if (!response.ok()) return false;
    const cells = (await response.json()).content.cells;
    const index = cells.findIndex((cell: any) => cell.id === 'helper');
    return index >= 0 && cells[index + 1]?.cell_type === 'markdown'
      && cells[index + 1]?.source.includes('&`bump_alias`')
      && cells.filter((cell: any) => cell.source.includes('&`bump_alias`')).length === 1;
  }).toBeTruthy();
  await page.reload();
  await expect(notebook.locator('.jp-MarkdownCell:not(.nbinlineai-prompt-cell):not(.nbinlineai-response-cell)')
    .filter({ hasText: 'bump_alias' })).toHaveCount(1);
});

test('native Run All waits for two helper insertions in order before the next AI question', async ({ page, request }) => {
  const name = await openNotebook(page, request, [
    code('setup', 'counter = 0\ndef bump(value: int) -> int:\n    global counter\n    counter += value\n    return counter\nbump_alias = bump'),
    code('helper', 'from nbinlineai.tools import insert_tools, search_kernel_names\nfirst = insert_tools(["bump_alias"], custom={"bump_alias": bump_alias})\nsecond = insert_tools(["search_kernel_names"])\nfirst, second'),
    question('lower-question', 'E2E_INHERIT_CALL_ALIAS Use the declared bump_alias tool once.')
  ]);
  let promptPosts = 0;
  page.on('request', item => {
    if (item.url().endsWith('/nbinlineai/prompt') && item.method() === 'POST') promptPosts += 1;
  });
  await runAllFromMenu(page);
  const notebook = page.locator('.jp-NotebookPanel:visible .jp-Notebook');
  await expect(notebook.locator('.nbinlineai-prompt-cell').first().locator('.nbinlineai-status')).toContainText(/Done|Answer kept/);
  await expect(notebook.locator('.nbinlineai-response-cell').first()).toContainText('Result: 4');
  expect(promptPosts).toBe(1);
  await page.keyboard.press('ControlOrMeta+s');
  await expect.poll(async () => {
    const response = await request.get(`/api/contents/${name}?content=1`);
    if (!response.ok()) return false;
    const cells = (await response.json()).content.cells;
    const helper = cells.findIndex((cell: any) => cell.id === 'helper');
    return helper >= 0 && cells[helper + 1]?.source.includes('&`bump_alias`')
      && cells[helper + 2]?.source.includes('&`search_kernel_names`');
  }).toBeTruthy();
});
