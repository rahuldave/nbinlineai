import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '../support/e2e-fixtures';

const starterNames = [
  'search_kernel_names', 'list_notebooks', 'find_notebook_cells', 'read_notebook_cell',
  'inspect_python', 'read_url', 'path_info', 'list_files', 'view_file', 'create_file',
  'file_str_replace', 'file_insert_line', 'file_replace_lines', 'show_doc',
  'list_cells', 'read_cell', 'insert_markdown', 'insert_code', 'url_to_note'
];

async function savedContent(request: APIRequestContext, path: string): Promise<any> {
  const response = await request.get(`/api/contents/${path}?content=1`);
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()).content;
}

async function saveNotebook(page: Page, name: string): Promise<void> {
  const saved = page.waitForResponse(response =>
    new URL(response.url()).pathname === `/api/contents/${name}` &&
    response.request().method() === 'PUT', { timeout: 3000 }).catch(() => null);
  await page.keyboard.press('ControlOrMeta+s');
  const response = await saved;
  if (response) expect(response.ok(), await response.text()).toBeTruthy();
}

test('starter lesson runs real tool calls from its inserted catalog and leaves code for the reader', async ({ page, request }) => {
  test.setTimeout(120_000);
  await request.get('/lab');
  const xsrf = (await request.storageState()).cookies.find(cookie => cookie.name === '_xsrf')?.value;
  expect(xsrf).toBeTruthy();
  const headers = { 'X-XSRFToken': xsrf! };
  const key = await request.post('/nbinlineai/settings/keys', {
    headers, data: { backend: 'openai_api', key: 'e2e-no-network-openai' }
  });
  expect(key.ok(), await key.text()).toBeTruthy();

  const example = JSON.parse(readFileSync(resolve('examples/starter-tools-tutorial.ipynb'), 'utf8'));
  const generatedIds = new Set<string>(example.metadata.nbinlineaiTutorial?.generatedCellIds || []);
  example.cells = example.cells.filter((item: any) =>
    !generatedIds.has(item.id) &&
    !item.metadata?.nbinlineai?.isOutputCell &&
    !item.metadata?.nbinlineaiWorkedEvidence);
  for (const item of example.cells) {
    if (item.cell_type === 'code') {
      item.execution_count = null;
      item.outputs = [];
    }
    if (item.metadata?.nbinlineai?.isPromptCell) item.metadata.nbinlineai.keepAnswer = false;
    if (item.id === 'starter-live-scratch') {
      item.source = '### Field note to edit in place\n\nI have not added my note yet.\n';
    }
  }
  example.metadata.nbinlineai.defaults.backend = 'openai_api';
  example.metadata.nbinlineai.defaults.keepAnswers = false;
  const name = `starter-tools-${Date.now()}-${Math.floor(Math.random() * 1e6)}.ipynb`;
  const uploaded = await request.put(`/api/contents/${name}`, {
    headers, data: { type: 'notebook', format: 'json', content: example }
  });
  expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
  await page.goto(`/lab/workspaces/${name.slice(0, -6)}/tree/${name}`);
  await page.setViewportSize({ width: 1500, height: 1200 });
  const notebook = page.locator('.jp-NotebookPanel:visible .jp-Notebook');
  let modelCells = example.cells;
  async function syncModel(): Promise<void> {
    await saveNotebook(page, name);
    modelCells = (await savedContent(request, name)).cells;
  }
  async function cell(id: string) {
    const index = modelCells.findIndex((item: any) => item.id === id);
    expect(index, `model contains ${id}`).toBeGreaterThanOrEqual(0);
    const target = notebook.locator(`.jp-Cell[data-windowed-list-index="${index}"]`);
    await expect.poll(async () => {
      if (await target.count()) return true;
      const shown = await notebook.locator('.jp-Cell[data-windowed-list-index]').evaluateAll(nodes =>
        nodes.map(node => Number(node.getAttribute('data-windowed-list-index'))));
      const direction = index < Math.min(...shown) ? -1 : 1;
      await page.locator('.jp-NotebookPanel:visible .jp-WindowedPanel-outer').evaluate((node, sign) => {
        node.scrollTop += sign * Math.max(300, node.clientHeight * 0.8);
      }, direction);
      return (await target.count()) === 1;
    }).toBeTruthy();
    await target.scrollIntoViewIfNeeded();
    return target;
  }
  await expect(notebook.locator('.nbinlineai-prompt-cell')).toHaveCount(5);
  await expect.poll(async () => {
    const sessions = await request.get('/api/sessions');
    return sessions.ok() && (await sessions.json()).some((session: any) =>
      session.path === name && session.kernel?.id);
  }).toBeTruthy();
  await expect(page.getByRole('button', { name: /Python.*\| Idle$/ })).toBeVisible();

  const setup = await cell('starter-setup');
  await setup.click();
  await page.keyboard.press('Shift+Enter');
  await expect(setup.locator('.jp-OutputArea')).toContainText('Prepared starter_field_study');
  const catalog = await cell('starter-catalog-call');
  await catalog.click();
  await page.keyboard.press('Shift+Enter');
  const declaration = notebook.locator('.jp-MarkdownCell').filter({
    has: page.locator('.jp-RenderedMarkdown p').filter({
      hasText: /^Available tools \(delete any line you do not want to offer\):$/
    })
  });
  await expect(declaration).toHaveCount(1);
  for (const name of starterNames) await expect(declaration).toContainText(name);
  await syncModel();
  const inspection = await cell('starter-catalog-inspect');
  await inspection.click();
  await page.keyboard.press('Shift+Enter');
  await expect(inspection.locator('.jp-OutputArea')).toContainText('inserted');
  await saveNotebook(page, name);
  const declaredNotebook = await savedContent(request, name);
  const callIndex = declaredNotebook.cells.findIndex((item: any) => item.id === 'starter-catalog-call');
  const inserted = declaredNotebook.cells[callIndex + 1];
  expect(inserted.cell_type).toBe('markdown');
  expect(String(inserted.source).match(/&`[a-z_]+`/g)).toHaveLength(19);
  expect(inserted.metadata.nbinlineai?.isOutputCell).toBeFalsy();
  const savedBook = await savedContent(request, 'starter_field_study/field_log.ipynb');
  expect(savedBook.cells.find((item: any) => item.id === 'field-log-observation')?.source)
    .toContain('STUDY_ANCHOR_SHADE');

  async function runQuestion(id: string): Promise<string> {
    const prompt = await cell(id);
    const posted = page.waitForRequest(item =>
      item.url().endsWith('/nbinlineai/prompt') && item.method() === 'POST');
    await prompt.locator('[data-nbinlineai-run]').click();
    const body = (await posted).postDataJSON();
    expect(body.backend).toBe('openai_api');
    await expect(prompt.locator('.nbinlineai-status')).toContainText(/Done|Answer kept/);
    const answers = (await notebook.locator('.nbinlineai-response-cell').allTextContents()).join('\n');
    await syncModel();
    return answers;
  }

  await runQuestion('starter-ai-files-create');
  let report = await savedContent(request, 'starter_field_study/report.md');
  expect(report).toContain('Bench A: 10 min shade, 31 C.');
  expect(report).toContain('The shaded benches were cooler in this small sample.');
  const createCheck = await cell('starter-files-create-check');
  await createCheck.click();
  await page.keyboard.press('Shift+Enter');
  await expect(createCheck.locator('.jp-OutputArea')).toContainText('Bench C: 50 min shade, 27 C.');

  await runQuestion('starter-ai-files-edit');
  report = await savedContent(request, 'starter_field_study/report.md');
  expect(report).toContain('this does not show cause.');
  expect(report).not.toContain('The shaded benches were cooler in this small sample.');
  const editCheck = await cell('starter-files-edit-check');
  await editCheck.click();
  await page.keyboard.press('Shift+Enter');
  await expect(editCheck.locator('.jp-OutputArea')).toContainText('Checked report:');

  const savedAnswers = await runQuestion('starter-ai-saved-search');
  expect(savedAnswers).toContain('field-log-observation');
  expect(savedAnswers).toContain('tree shade reached the seat by 14:00');

  await syncModel();
  const scratch = await cell('starter-live-scratch');
  await scratch.dblclick();
  await scratch.locator('.cm-content').fill('UNSAVED_SHADE_NOTE: At bench C, a cloud passed during the reading; revisit it. TEST_OBSERVATION_73');
  expect(String((await savedContent(request, name)).cells.find((item: any) => item.id === 'starter-live-scratch').source))
    .not.toContain('TEST_OBSERVATION_73');
  const liveAnswers = await runQuestion('starter-ai-live-read');
  expect(liveAnswers).toContain('UNSAVED_SHADE_NOTE');
  expect(liveAnswers).toContain('cloud passed during the reading');
  expect(liveAnswers).toContain('TEST_OBSERVATION_73');

  await runQuestion('starter-ai-report-insert');
  const summary = notebook.locator('.jp-MarkdownCell:not(.nbinlineai-prompt-cell):not(.nbinlineai-response-cell)')
    .filter({ hasText: 'Shade walk summary' });
  await expect(summary).toHaveCount(1);
  await expect(summary).toContainText('31');
  await expect(summary).toContainText('28');
  await expect(summary).toContainText('27');
  const draft = notebook.locator('.jp-CodeCell').filter({ hasText: 'csv.DictReader' });
  await expect(draft).toHaveCount(1);
  await expect(draft.locator('.cm-content')).toContainText('starter_field_study/observations.csv');
  expect(await draft.locator('.jp-InputPrompt').textContent()).not.toMatch(/\[\d+\]/);
  await expect(draft.locator('.jp-OutputArea-output')).toHaveCount(0);
  await saveNotebook(page, name);
  const persisted = await savedContent(request, name);
  const savedDraft = persisted.cells.find((item: any) =>
    item.cell_type === 'code' && String(item.source).includes('csv.DictReader'));
  expect(savedDraft?.execution_count).toBeNull();
  expect(savedDraft?.outputs).toEqual([]);
  await draft.click();
  await page.keyboard.press('Shift+Enter');
  await expect(draft.locator('.jp-OutputArea')).toContainText('Bench A: 10 min shade, 31 C.');
  await expect(draft.locator('.jp-OutputArea')).toContainText('Bench C: 50 min shade, 27 C.');
});
