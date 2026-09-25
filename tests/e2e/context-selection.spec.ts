import { expect, test, type APIRequestContext, type Locator, type Page } from '../support/e2e-fixtures';

type Cell = {
  id: string;
  cell_type: 'code' | 'markdown' | 'raw';
  source: string;
  metadata: Record<string, unknown>;
  outputs?: unknown[];
  execution_count?: null;
};

const code = (id: string, source: string, metadata: Record<string, unknown> = {}): Cell =>
  ({ id, cell_type: 'code', source, metadata, outputs: [], execution_count: null });
const markdown = (id: string, source: string, metadata: Record<string, unknown> = {}): Cell =>
  ({ id, cell_type: 'markdown', source, metadata });
const question = (id: string, source: string): Cell =>
  markdown(id, source, { nbinlineai: { isPromptCell: true } });
const answer = (id: string, promptId: string, source: string): Cell =>
  markdown(id, source, { nbinlineai: { isOutputCell: true, promptCellId: promptId, status: 'done' } });
const raw = (id: string, source: string): Cell => ({ id, cell_type: 'raw', source, metadata: {} });

const panel = (page: Page) => page.locator('.jp-NotebookPanel:visible');
const notebook = (page: Page) => panel(page).locator('.jp-Notebook');
const cells = (page: Page) => notebook(page).locator('.jp-Cell');
const mode = (page: Page) => panel(page).locator('[data-nbinlineai-context-mode]');
const target = (page: Page) => panel(page).locator('[data-nbinlineai-context-target]');
const details = (page: Page) => panel(page).locator('[data-nbinlineai-context-details]');
const box = (cell: Locator) => cell.locator('[data-nbinlineai-context-include]');
const toolsBox = (cell: Locator) => cell.locator('[data-nbinlineai-tools-include]');

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

async function openNotebook(page: Page, request: APIRequestContext, fixture: Cell[]) {
  const name = `context-${Date.now()}-${Math.floor(Math.random() * 1e6)}.ipynb`;
  const xsrf = (await request.storageState()).cookies.find(cookie => cookie.name === '_xsrf')?.value;
  const response = await request.put(`/api/contents/${name}`, {
    headers: { 'X-XSRFToken': xsrf! },
    data: { type: 'notebook', format: 'json', content: {
      cells: fixture,
      metadata: { kernelspec: { display_name: 'Python 3 (nbinlineai E2E)', language: 'python', name: 'python3' } },
      nbformat: 4, nbformat_minor: 5
    } }
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  await page.goto(`/lab/workspaces/${name.slice(0, -6)}/tree/${name}`);
  await expect(cells(page)).toHaveCount(fixture.length);
  await expect(mode(page)).toBeVisible();
  await expect.poll(async () => {
    const sessions = await request.get('/api/sessions');
    return sessions.ok() && (await sessions.json()).some((s: any) => s.path === name && s.kernel?.id);
  }).toBeTruthy();
  await waitKernelIdle(page);
  return name;
}

async function waitKernelIdle(page: Page) {
  const name = decodeURIComponent(new URL(page.url()).pathname.split('/').pop() || '');
  await expect.poll(async () => {
    const sessions = await page.request.get('/api/sessions');
    if (!sessions.ok()) return false;
    const session = (await sessions.json()).find((item: any) => item.path === name);
    if (!session?.kernel?.id) return false;
    const kernel = await page.request.get(`/api/kernels/${session.kernel.id}`);
    return kernel.ok() && (await kernel.json()).execution_state === 'idle';
  }, { timeout: 30_000 }).toBeTruthy();
  // The REST kernel can be idle before this browser finishes its connection.
  await expect(page.getByRole('button', { name: /Python.*\| Idle$/ })).toBeVisible();
}

async function savedNotebook(request: APIRequestContext, name: string) {
  const response = await request.get(`/api/contents/${name}?content=1`);
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()).content;
}

async function save(page: Page) {
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.getByText('Saving completed')).toBeVisible();
}

async function preview(page: Page) {
  await waitKernelIdle(page);
  await openDetails(page);
  const response = page.waitForResponse(r => r.url().endsWith('/nbinlineai/context-preview') && r.request().method() === 'POST');
  await panel(page).locator('[data-nbinlineai-context-refresh]').click();
  const result = await response;
  expect(result.ok(), await result.text()).toBeTruthy();
  return { body: await result.json(), request: result.request().postDataJSON() };
}

async function openDetails(page: Page) {
  if (await details(page).getAttribute('open') === null) {
    await details(page).locator('summary').click();
  }
  await expect(details(page)).toHaveAttribute('open', '');
}

async function selectQuestion(page: Page, index: number) {
  await cells(page).nth(index).locator('.jp-Cell-inputWrapper').click();
  await openDetails(page);
  await expect(target(page)).toHaveText(`Context for AI question ${index + 1}`);
}

test('collapsed Context has one disclosure; Details explains a no-AI context check without duplicate instructions', async ({ page, request, browserName }) => {
  await openNotebook(page, request, [code('source', 'value = 3'), question('ask', 'E2E_BASIC explain the value')]);
  const row = panel(page).locator('.nbinlineai-context-row');
  const summary = details(page).locator('summary');
  const check = panel(page).locator('[data-nbinlineai-context-refresh]');
  await expect(summary).toHaveText('Details');
  await expect(details(page)).not.toHaveAttribute('open', '');
  await expect(check).toBeHidden();
  await expect(target(page)).toBeHidden();
  await expect(panel(page).locator('[data-nbinlineai-context-status]')).toBeHidden();
  await expect(row).toBeVisible();
  expect(await cells(page).allInnerTexts()).not.toEqual(expect.arrayContaining([expect.stringContaining('Select an AI question')]));
  const markers = await summary.evaluate(element => ({
    listStyle: getComputedStyle(element).listStyleType,
    customArrow: getComputedStyle(element, '::before').borderLeftWidth
  }));
  expect(markers).toEqual({ listStyle: 'none', customArrow: '6px' });
  await row.screenshot({ path: `test-results/context-toolbar-${browserName}.png` });

  let providerRequests = 0;
  let previewRequests = 0;
  page.on('request', item => {
    if (item.url().endsWith('/nbinlineai/prompt')) providerRequests += 1;
    if (item.url().endsWith('/nbinlineai/context-preview')) previewRequests += 1;
  });
  await openDetails(page);
  await expect(target(page)).toHaveText('Click an AI question to check its context.');
  await expect(page.getByText('Click an AI question to check its context.', { exact: true })).toHaveCount(1);
  await expect(panel(page).locator('[data-nbinlineai-context-status]')).toBeEmpty();
  await expect(panel(page).locator('[data-nbinlineai-context-report]')).toBeEmpty();
  await expect(check).toHaveAccessibleName('Check context');
  await expect(check).toBeDisabled();
  await expect(check).toHaveAttribute('title', /does not ask the AI or change the notebook/i);
  await expect(check).toHaveAttribute('aria-description', /does not ask the AI or change the notebook/i);
  await expect(panel(page).locator('[data-nbinlineai-context-status]')).toHaveAttribute('aria-live', 'polite');
  await expect(panel(page).locator('[data-nbinlineai-context-status]')).toHaveAttribute('aria-atomic', 'true');
  await expect(details(page)).toContainText(/without asking the AI/i);
  expect(providerRequests).toBe(0);
  expect(previewRequests).toBe(0);

  await selectQuestion(page, 1);
  await expect(target(page)).toHaveText('Context for AI question 2');
  await expect(panel(page).locator('[data-nbinlineai-context-status]')).toContainText('Context checked:');
  await expect(check).toBeEnabled();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let intercepted!: () => void;
  const held = new Promise<void>(resolve => { intercepted = resolve; });
  let delayNext = true;
  await page.route('**/nbinlineai/context-preview', async route => {
    if (!delayNext) { await route.continue(); return; }
    delayNext = false;
    const response = await route.fetch();
    intercepted();
    await gate;
    await route.fulfill({ response });
  });
  const completed = page.waitForResponse(response => response.url().endsWith('/nbinlineai/context-preview') && response.request().method() === 'POST');
  await check.click();
  await held;
  await expect(check).toBeDisabled();
  await expect(check).toHaveText('Checking…');
  await expect(panel(page).locator('[data-nbinlineai-context-status]')).toHaveText('Checking…');
  release();
  const result = await completed;
  expect((await result.json()).included_cell_ids).toContain('source');
  const status = panel(page).locator('[data-nbinlineai-context-status]');
  await expect(status).toContainText(/Context checked: 1 cell, 0 tools · Last checked/);
  await expect(check).toHaveText('Check context');
  const checkedAt = status.locator('[data-nbinlineai-context-checked-at]');
  const firstTime = await checkedAt.getAttribute('dateTime');
  expect(firstTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  await check.click();
  await expect.poll(async () => {
    const value = await checkedAt.getAttribute('dateTime');
    return value && value !== firstTime ? value : null;
  }).not.toBeNull();
  await expect(status).toContainText(/Context checked: 1 cell, 0 tools · Last checked/);
  await page.route('**/nbinlineai/context-preview', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await check.click();
  await expect(status).toHaveText('Context check failed');
  await expect(status.locator('[data-nbinlineai-context-checked-at]')).toHaveCount(0);
  await expect(panel(page).locator('[data-nbinlineai-context-report]')).toContainText('Context preview failed (503).');
  await expect(check).toBeEnabled();
  expect(providerRequests).toBe(0);
});

test('each cell places its own controls above its text and keeps the question plainly included', async ({ page, request, browserName }) => {
  await openNotebook(page, request, [
    code('definition', 'def factor(value: int):\n    return value + 1'),
    markdown('notes', '## Lesson notes\nUse &`factor` for the next question.'),
    question('ask', 'E2E_BASIC explain factor'),
    answer('reply', 'ask', 'Factor adds one to the value.')
  ]);
  const definition = cells(page).first();
  await definition.click();
  await page.keyboard.press('Shift+Enter');
  await expect(definition.locator('.jp-InputPrompt')).toContainText('1');
  await selectQuestion(page, 2);
  const all = cells(page);
  const questionCell = all.nth(2);
  await expect(box(questionCell)).toBeHidden();
  await expect(questionCell.locator('[data-nbinlineai-context-text]')).toHaveText('Current question · always included');
  await expect(all.nth(1).locator('[data-nbinlineai-tools-include]')).toBeVisible();
  await expect(questionCell.locator('[data-nbinlineai-run]')).toBeVisible();

  async function assertCell(index: number, hasPromptControls: boolean) {
    const cell = all.nth(index);
    const host = cell.locator(':scope > [data-nbinlineai-cell-controls]');
    const line = host.locator('[data-nbinlineai-cell-context-line]');
    const input = cell.locator(':scope > .jp-Cell-inputWrapper');
    const editor = input.locator('.jp-InputArea-editor');
    const [hostBox, lineBox, inputBox, editorBox] = await Promise.all([
      host.boundingBox(), line.boundingBox(), input.boundingBox(), editor.boundingBox()
    ]);
    expect(hostBox).not.toBeNull();
    expect(lineBox).not.toBeNull();
    expect(inputBox).not.toBeNull();
    expect(hostBox!.y + hostBox!.height).toBeLessThanOrEqual(inputBox!.y + 2);
    const renderedBox = editorBox ? null : await cell.locator('.jp-RenderedHTMLCommon > :first-child').boundingBox();
    const textBox = editorBox || renderedBox;
    expect(textBox).not.toBeNull();
    expect(lineBox!.y + lineBox!.height).toBeLessThanOrEqual(textBox!.y + 2);
    expect(Math.abs(lineBox!.x - textBox!.x)).toBeLessThanOrEqual(editorBox ? 8 : 24);
    if (hasPromptControls) {
      const runRow = host.locator('.nbinlineai-controls');
      const runBox = await runRow.boundingBox();
      expect(runBox).not.toBeNull();
      expect(lineBox!.y + lineBox!.height).toBeLessThanOrEqual(runBox!.y + 2);
      expect(runBox!.y + runBox!.height).toBeLessThanOrEqual(inputBox!.y + 2);
      expect(Math.abs(runBox!.x - textBox!.x)).toBeLessThanOrEqual(editorBox ? 8 : 24);
    }
  }
  await assertCell(0, false);
  await assertCell(1, false);
  await assertCell(2, true);
  await assertCell(3, false);

  const markdownCell = all.nth(1);
  await questionCell.locator('[data-nbinlineai-keep-answer]').uncheck();
  await markdownCell.dblclick();
  await expect(markdownCell.locator('.cm-content')).toBeVisible();
  await assertCell(1, false);
  let providerRequests = 0;
  page.on('request', item => { if (item.url().endsWith('/nbinlineai/prompt')) providerRequests += 1; });
  await questionCell.locator('[data-nbinlineai-run]').click();
  await expect(questionCell.locator('.nbinlineai-status')).toContainText('Done');
  expect(providerRequests).toBe(1);
  await markdownCell.dblclick();
  await expect(markdownCell.locator('.cm-content')).toBeVisible();
  await expect(questionCell.locator('[data-nbinlineai-override-editor]')).toBeHidden();
  await questionCell.locator('[data-nbinlineai-override]').click();
  await expect(questionCell.locator('[data-nbinlineai-override-editor]')).toBeVisible();
  await preview(page);
  await expect(box(all.nth(0))).toBeEnabled();
  await all.nth(0).locator('[data-nbinlineai-context-include]').click();
  await expect(target(page)).toHaveText('Context for AI question 3');
  await expect(all).toHaveCount(4);
  await save(page);
  await page.reload();
  await expect(all).toHaveCount(4);
  await selectQuestion(page, 2);
  await assertCell(2, true);
  await expect(box(questionCell)).toBeHidden();
  await panel(page).screenshot({ path: `test-results/cell-controls-top-${browserName}.png` });
});

test('one click changes lower Context, Tools, and Keep choices after editing earlier Markdown', async ({ page, request }) => {
  await openNotebook(page, request, [
    code('definition', 'def factor(value: int):\n    return value + 1'),
    markdown('editing', '## Earlier note\nEdit this note before choosing lower controls.'),
    markdown('declaration', '&`factor`'),
    code('source', 'value = 3'),
    question('ask', 'E2E_BASIC explain value'),
    answer('reply', 'ask', 'The value is three.')
  ]);
  const all = cells(page);
  await all.first().click();
  await page.keyboard.press('Shift+Enter');
  await expect(all.first().locator('.jp-InputPrompt')).toContainText('1');
  await selectQuestion(page, 4);
  await mode(page).selectOption('all-above');
  await preview(page);
  await expect(toolsBox(all.nth(2))).toBeChecked();
  await expect(box(all.nth(3))).toBeChecked();
  await expect(all.nth(4).locator('[data-nbinlineai-keep-answer]')).toBeChecked();

  async function editEarlier() {
    const editor = all.nth(1).locator('.cm-content');
    if (!(await editor.isVisible())) await all.nth(1).locator('.jp-RenderedHTMLCommon').dblclick();
    else await editor.click();
    await expect(editor).toBeVisible();
  }
  await editEarlier();
  await toolsBox(all.nth(2)).uncheck();
  await expect(toolsBox(all.nth(2))).not.toBeChecked();
  await expect(target(page)).toHaveText('Context for AI question 5');
  await editEarlier();
  await expect(box(all.nth(3))).toBeEnabled();
  await box(all.nth(3)).uncheck();
  await expect(box(all.nth(3))).not.toBeChecked();
  await expect(target(page)).toHaveText('Context for AI question 5');
  await editEarlier();
  await all.nth(4).locator('[data-nbinlineai-keep-answer]').uncheck();
  await expect(all.nth(4).locator('[data-nbinlineai-keep-answer]')).not.toBeChecked();
  await expect(all).toHaveCount(6);
});

test('all seven modes use physical windows and expose authoritative selected IDs', async ({ page, request }) => {
  const fixture: Cell[] = [];
  for (let i = 0; i < 12; i++) fixture.push(i === 2 ? raw(`a${i}`, 'RAW_COUNTS_AS_POSITION') : code(`a${i}`, `ABOVE_${i}`));
  fixture.push(question('current', 'E2E_CONTEXT_AUDIT What is selected?'));
  fixture.push(answer('own-answer', 'current', 'OWN_ANSWER_MUST_BE_EXCLUDED'));
  for (let i = 0; i < 12; i++) fixture.push(code(`b${i}`, `BELOW_${i}`));
  await openNotebook(page, request, fixture);
  await selectQuestion(page, 12);
  const expectations: Record<string, string[]> = {
    'default': Array.from({ length: 12 }, (_, i) => `a${i}`).filter(id => id !== 'a2'),
    'current-only': [],
    'all-above': Array.from({ length: 12 }, (_, i) => `a${i}`).filter(id => id !== 'a2'),
    'ten-above': Array.from({ length: 10 }, (_, i) => `a${i + 2}`).filter(id => id !== 'a2'),
    'ten-above-below': [
      ...Array.from({ length: 10 }, (_, i) => `a${i + 2}`).filter(id => id !== 'a2'),
      ...Array.from({ length: 10 }, (_, i) => `b${i}`)
    ],
    'full-notebook': [
      ...Array.from({ length: 12 }, (_, i) => `a${i}`).filter(id => id !== 'a2'),
      ...Array.from({ length: 12 }, (_, i) => `b${i}`)
    ]
  };
  for (const [choice, expected] of Object.entries(expectations)) {
    await mode(page).selectOption(choice);
    const result = await preview(page);
    expect(result.request.context_mode).toBe(choice);
    expect(result.request.notebook_cells.map((cell: any) => cell.id)).toEqual(fixture.map(cell => cell.id));
    expect(result.body.selected_cell_ids.slice().sort()).toEqual(expected.sort());
    expect(result.body.selected_cell_ids).not.toContain('current');
    expect(result.body.selected_cell_ids).not.toContain('own-answer');
    expect(result.body.selected_cell_ids).not.toContain('a2');
  }
  await openDetails(page);
  await expect(panel(page).locator('[data-nbinlineai-context-report]')).toContainText(/selected|included/i);
  const panelBounds = await panel(page).boundingBox();
  const refreshBounds = await panel(page).locator('[data-nbinlineai-context-refresh]').boundingBox();
  expect(panelBounds && refreshBounds && refreshBounds.x + refreshBounds.width <= panelBounds.x + panelBounds.width + 1).toBeTruthy();
  await mode(page).selectOption('custom');
  const custom = await preview(page);
  expect(custom.body.context_mode).toBe('custom');
  expect(custom.body.selected_cell_ids).not.toContain('own-answer');
  await cells(page).last().scrollIntoViewIfNeeded();
  await expect(cells(page).last().locator('[data-nbinlineai-context-control]')).toHaveCount(1);
  await cells(page).first().scrollIntoViewIfNeeded();
  await expect(cells(page).first()).toContainText('ABOVE_0');
  await expect(cells(page).first().locator('[data-nbinlineai-context-control]')).toHaveCount(1);
});

test('Default displays the real budget boundary and preview alone does not dirty the notebook', async ({ page, request }) => {
  const name = await openNotebook(page, request, [
    markdown('large', `OLDER_SOURCE_${'界'.repeat(58_000)}`),
    code('near', `near = '${'N'.repeat(8_000)}' # NEAREST_SOURCE`),
    question('current', 'E2E_BASIC show included context')
  ]);
  // Kernel startup may update Jupyter's own notebook metadata; establish a clean baseline.
  await save(page);
  const beforeReload = await savedNotebook(request, name);
  await page.reload();
  await expect(mode(page)).toBeVisible();
  await waitKernelIdle(page);
  await save(page);
  const baseline = await savedNotebook(request, name);
  expect(baseline.metadata.nbinlineai).toEqual(beforeReload.metadata.nbinlineai);
  expect(baseline.cells.map((cell: any) => cell.metadata?.nbinlineai)).toEqual(
    beforeReload.cells.map((cell: any) => cell.metadata?.nbinlineai)
  );
  await expect(page.locator('.lm-TabBar-tab.jp-mod-dirty')).toHaveCount(0);
  await selectQuestion(page, 2);
  const first = await preview(page);
  expect(first.body.included_cell_ids).toContain('near');
  expect(first.body.partial_cell_ids).toContain('large');
  await expect(box(cells(page).first())).toHaveJSProperty('indeterminate', true);
  await expect(page.locator('.lm-TabBar-tab.jp-mod-dirty')).toHaveCount(0);
  expect(await savedNotebook(request, name)).toEqual(baseline);
  await mode(page).selectOption('all-above');
  const explicit = await preview(page);
  expect(explicit.body.selected_cell_ids).toContain('large');
  await expect(box(cells(page).first())).toBeChecked();
  await expect(cells(page).first().locator('[data-nbinlineai-context-budget]')).toContainText('partial');
});

test('Default retains legacy whitespace source while explicit scope treats it as empty', async ({ page, request }) => {
  await openNotebook(page, request, [markdown('spaces', '   '), question('current', 'E2E_BASIC inspect the scope')]);
  await selectQuestion(page, 1);
  const automatic = await preview(page);
  expect(automatic.body.included_cell_ids).toContain('spaces');
  await expect(box(cells(page).first())).toBeChecked();
  await mode(page).selectOption('all-above');
  const explicit = await preview(page);
  expect(explicit.body.selected_cell_ids).not.toContain('spaces');
  await expect(box(cells(page).first())).toBeDisabled();
});

test('the AI Prompt toolbar immediately targets its newly inserted question', async ({ page, request }) => {
  await openNotebook(page, request, [code('setup', 'value = 4')]);
  await cells(page).first().click();
  await page.getByRole('button', { name: 'AI Prompt' }).click();
  const prompt = notebook(page).locator('.nbinlineai-prompt-cell');
  await expect(prompt).toHaveCount(1);
  await openDetails(page);
  await expect(target(page)).toHaveText('Context for AI question 2');
  await prompt.locator('.cm-content').fill('E2E_BASIC explain value');
  await expect(target(page)).toHaveText('Context for AI question 2');
  await mode(page).selectOption('all-above');
  const report = await preview(page);
  expect(report.body.selected_cell_ids).toContain('setup');
  await expect(box(cells(page).first())).toBeChecked();
});

test('checkboxes retain the target and Custom choices survive save and reload', async ({ page, request }) => {
  const name = await openNotebook(page, request, [
    code('above', 'ABOVE_SELECTED', { lessonTag: 'keep-me' }),
    markdown('note', 'NOTE_SELECTED'),
    question('current', 'E2E_CONTEXT_AUDIT explain the note'),
    answer('own-answer', 'current', 'OLD_OWN_ANSWER'),
    code('below', 'BELOW_SELECTED')
  ]);
  await selectQuestion(page, 2);
  await expect(box(cells(page).nth(0))).toHaveAttribute('aria-label', 'Include in AI context');
  await expect(box(cells(page).nth(1))).toHaveAttribute('aria-label', 'Include in AI context');
  await expect(box(cells(page).nth(2))).toBeHidden();
  await expect(cells(page).nth(2).locator('[data-nbinlineai-context-text]')).toHaveText('Current question · always included');
  await expect(box(cells(page).nth(3))).toBeDisabled();
  await mode(page).selectOption('full-notebook');
  await expect(box(cells(page).nth(4))).toBeChecked();
  await box(cells(page).nth(0)).uncheck();
  await expect(mode(page)).toHaveValue('custom');
  await expect(target(page)).toContainText('3');
  await cells(page).nth(1).locator('[data-nbinlineai-context-control]').click();
  await expect(box(cells(page).nth(1))).not.toBeChecked();
  await expect(target(page)).toContainText('3');
  await cells(page).nth(1).locator('[data-nbinlineai-context-control]').click();
  await expect(box(cells(page).nth(1))).toBeChecked();
  await box(cells(page).nth(4)).focus();
  await page.keyboard.press('Space');
  await expect(box(cells(page).nth(4))).not.toBeChecked();
  await save(page);
  const saved = await savedNotebook(request, name);
  expect(saved.metadata.nbinlineai.defaults.contextMode).toBe('custom');
  const byId = Object.fromEntries(saved.cells.map((cell: any) => [cell.id, cell.metadata?.nbinlineai?.contextInclude]));
  expect(byId.above).toBe(false);
  expect(byId.note).toBe(true);
  expect(byId.below).toBe(false);
  expect(byId['own-answer']).toBe(false);
  expect(saved.cells.find((cell: any) => cell.id === 'above').metadata.lessonTag).toBe('keep-me');
  await page.reload();
  await expect(mode(page)).toHaveValue('custom');
  await selectQuestion(page, 2);
  await expect(box(cells(page).nth(0))).not.toBeChecked();
  await expect(box(cells(page).nth(1))).toBeChecked();
  await expect(box(cells(page).nth(4))).not.toBeChecked();
  await mode(page).selectOption('ten-above');
  await mode(page).selectOption('custom');
  await expect(box(cells(page).nth(0))).not.toBeChecked();
  await expect(box(cells(page).nth(4))).not.toBeChecked();
  await cells(page).last().click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('b');
  await expect(cells(page)).toHaveCount(6);
  await cells(page).last().locator('.cm-content').fill('NEW_CUSTOM_CELL = 1');
  await selectQuestion(page, 2);
  await expect(box(cells(page).last())).toBeChecked();
});

test('preview and execution share one selection while inherited tools stay available', async ({ page, request }) => {
  await openNotebook(page, request, [
    code('setup', 'counter = 0\ndef bump(value: int):\n    global counter\n    counter += value\n    return counter'),
    markdown('declaration', '&`bump`\nFAR_ABOVE_DECLARATION'),
    code('excluded', 'EXCLUDED_PROSE'),
    question('current', 'E2E_INHERIT_INSPECT Which schemas are available?'),
    code('later', 'LATER_SOURCE'),
    markdown('later-declaration', '&`missing_below`')
  ]);
  const setup = cells(page).first();
  await setup.click();
  await page.keyboard.press('Shift+Enter');
  await expect(setup.locator('.jp-InputPrompt')).toContainText('1');
  await selectQuestion(page, 3);
  await preview(page);
  await mode(page).selectOption('custom');
  await box(cells(page).nth(1)).uncheck();
  await box(cells(page).nth(2)).uncheck();
  await box(cells(page).nth(4)).check();
  let providerCalls = 0;
  page.on('request', req => { if (req.url().endsWith('/nbinlineai/prompt')) providerCalls++; });
  const before = await preview(page);
  expect(providerCalls).toBe(0);
  expect(JSON.stringify(before.body.tools)).toContain('bump');
  expect(JSON.stringify(before.body.tools)).not.toContain('missing_below');
  expect(before.body.selected_cell_ids).not.toContain('declaration');
  expect(before.body.selected_cell_ids).toContain('later');
  const posted = page.waitForRequest(req => req.url().endsWith('/nbinlineai/prompt') && req.method() === 'POST');
  const stream = page.waitForResponse(res => res.url().endsWith('/nbinlineai/prompt') && res.request().method() === 'POST');
  await cells(page).nth(3).locator('[data-nbinlineai-run]').click();
  const body = (await posted).postDataJSON();
  expect(body.context_mode).toBe('custom');
  expect(body.notebook_cells.find((cell: any) => cell.id === 'declaration').context_include).toBe(false);
  await expect(cells(page).nth(3).locator('.nbinlineai-status')).toContainText(/Done|Answer kept/);
  const reply = notebook(page).locator('.nbinlineai-response-cell');
  await expect(reply).toContainText('INHERITED_SCHEMAS=bump');
  await expect(reply).not.toContainText('missing_below');
  expect(providerCalls).toBe(1);
  const frames = (await (await stream).text()).split('\n\n').filter(frame => frame.startsWith('data: '));
  const context = frames.map(frame => JSON.parse(frame.slice(6))).find(event => event.type === 'context');
  expect(context).toBeTruthy();
  for (const field of ['selected_cell_ids', 'included_cell_ids', 'omitted_cell_ids', 'partial_cell_ids']) {
    expect(context[field]).toEqual(before.body[field]);
  }
});

test('tool declarations have independent saved choices across modes, duplicates, and the current question', async ({ page, request }) => {
  const name = await openNotebook(page, request, [
    code('setup', [
      'def bump(value: int):', '    return value + 1',
      'def current_func(value: int):', '    return value + 2',
      'def missing_below(value: int):', '    return value + 3'
    ].join('\n')),
    markdown('first-declaration', '&`bump`'),
    markdown('second-declaration', '&`bump`'),
    question('current', 'E2E_INHERIT_INSPECT list schemas &`current_func`'),
    markdown('below-declaration', '&`missing_below`')
  ]);
  const setup = cells(page).first();
  await setup.click();
  await page.keyboard.press('Shift+Enter');
  await expect(setup.locator('.jp-InputPrompt')).toContainText('1');
  await selectQuestion(page, 3);
  await mode(page).selectOption('current-only');
  let report = await preview(page);
  expect(report.body.selected_cell_ids).toEqual([]);
  expect(report.body.tools).toEqual(expect.arrayContaining(['bump', 'current_func']));
  expect(report.body.tools).not.toContain('missing_below');
  for (const index of [1, 2, 3]) {
    await expect(toolsBox(cells(page).nth(index))).toHaveAttribute('aria-label', 'Use tools from this cell');
    await expect(toolsBox(cells(page).nth(index))).toBeChecked();
  }
  await expect(toolsBox(cells(page).nth(1))).toHaveAccessibleDescription(/bump/);
  await expect(toolsBox(cells(page).nth(4))).toBeEnabled();
  await expect(cells(page).nth(4).locator('[data-nbinlineai-tools-state]')).toContainText(/below/i);
  await expect(toolsBox(cells(page).nth(4))).toHaveAccessibleDescription(/below/i);
  await toolsBox(cells(page).nth(1)).uncheck();
  report = await preview(page);
  expect(report.body.tools).toContain('bump');
  await toolsBox(cells(page).nth(2)).uncheck();
  await toolsBox(cells(page).nth(3)).uncheck();
  report = await preview(page);
  expect(report.body.tools).toEqual([]);
  await mode(page).selectOption('full-notebook');
  report = await preview(page);
  expect(report.body.tools).toEqual([]);
  await save(page);
  const saved = await savedNotebook(request, name);
  for (const id of ['first-declaration', 'second-declaration', 'current']) {
    expect(saved.cells.find((cell: any) => cell.id === id).metadata.nbinlineai.toolsInclude).toBe(false);
  }
  await page.reload();
  await cells(page).first().click();
  await page.keyboard.press('Shift+Enter');
  await expect(cells(page).first().locator('.jp-InputPrompt')).toContainText(/\d/);
  await selectQuestion(page, 3);
  await expect(toolsBox(cells(page).nth(1))).not.toBeChecked();
  await expect(toolsBox(cells(page).nth(3))).not.toBeChecked();
  await toolsBox(cells(page).nth(2)).check();
  await toolsBox(cells(page).nth(3)).check();
  report = await preview(page);
  expect(report.body.tools).toEqual(expect.arrayContaining(['bump', 'current_func']));
  const posted = page.waitForRequest(req => req.url().endsWith('/nbinlineai/prompt') && req.method() === 'POST');
  await cells(page).nth(3).locator('[data-nbinlineai-run]').click();
  expect((await posted).postDataJSON().context_mode).toBe('full-notebook');
  await expect(cells(page).nth(3).locator('.nbinlineai-status')).toContainText(/Done|Answer kept/);
  await expect(notebook(page).locator('.nbinlineai-response-cell')).toContainText('INHERITED_SCHEMAS=current_func,bump');
});

test('AI halves remain independent and later AI text is source, not earlier conversation', async ({ page, request }) => {
  await openNotebook(page, request, [
    answer('own-moved', 'current', 'OWN_MOVED_ANSWER'),
    question('earlier', 'EARLIER_AI_QUESTION'),
    answer('earlier-answer', 'earlier', 'EARLIER_AI_ANSWER'),
    markdown('current', 'E2E_AI_AUDIT inspect placement', {
      nbinlineai: { isPromptCell: true, keepAnswer: false }
    }),
    question('later', 'LATER_AI_QUESTION'),
    answer('later-answer', 'later', 'LATER_AI_ANSWER')
  ]);
  const editableAnswer = cells(page).nth(2);
  await editableAnswer.locator('.jp-RenderedMarkdown').dblclick();
  await expect(editableAnswer.locator('.cm-content')).toBeVisible();
  await editableAnswer.locator('.cm-content').press('End');
  await editableAnswer.locator('.cm-content').pressSequentially('_TYPED', { delay: 20 });
  await expect(editableAnswer.locator('.cm-content')).toContainText('EARLIER_AI_ANSWER_TYPED');
  await expect(editableAnswer.locator('.cm-content')).toBeVisible();
  await selectQuestion(page, 3);
  await mode(page).selectOption('full-notebook');
  const full = await preview(page);
  expect(full.body.selected_cell_ids).toEqual(expect.arrayContaining([
    'earlier', 'earlier-answer', 'later', 'later-answer'
  ]));
  expect(full.body.selected_cell_ids).not.toContain('own-moved');
  await cells(page).nth(3).locator('[data-nbinlineai-run]').click();
  await expect(cells(page).nth(3).locator('.nbinlineai-status')).toContainText(/Done|Answer kept/);
  const reply = notebook(page).locator('.nbinlineai-response-cell').first();
  await expect(reply).toContainText('EARLIER_AI_QUESTION=user');
  await expect(reply).toContainText('EARLIER_AI_ANSWER=assistant');
  await expect(reply).toContainText('LATER_AI_QUESTION=system');
  await expect(reply).toContainText('LATER_AI_ANSWER=system');
  await expect(reply).toContainText('OWN_MOVED_ANSWER=absent');

  await selectQuestion(page, 3);
  await box(cells(page).nth(2)).uncheck();
  await expect(mode(page)).toHaveValue('custom');
  const independent = await preview(page);
  expect(independent.body.selected_cell_ids).toContain('earlier');
  expect(independent.body.selected_cell_ids).not.toContain('earlier-answer');
});

test('fresh runs use edits after preview and Run All resolves each question separately', async ({ page, request }) => {
  await openNotebook(page, request, [
    code('first-source', 'first_source = 1 # FIRST_SOURCE'),
    question('first', 'E2E_CONTEXT_AUDIT first question'),
    code('middle', 'middle_source = 2 # MIDDLE_BEFORE_EDIT'),
    question('second', 'E2E_CONTEXT_AUDIT second question')
  ]);
  await selectQuestion(page, 3);
  await mode(page).selectOption('all-above');
  await preview(page);
  await cells(page).nth(2).locator('.cm-content').fill('middle_source = 3 # MIDDLE_AFTER_EDIT');
  const bodies: any[] = [];
  page.on('request', req => {
    if (req.url().endsWith('/nbinlineai/prompt') && req.method() === 'POST') bodies.push(req.postDataJSON());
  });
  await page.locator('.lm-MenuBar-item').filter({ hasText: /^Run$/ }).click();
  await page.getByRole('menuitem', { name: 'Run All Cells', exact: true }).click();
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[0].prompt_cell_id).toBe('first');
  expect(bodies[1].prompt_cell_id).toBe('second');
  expect(bodies[1].notebook_cells.find((cell: any) => cell.id === 'middle').source).toBe('middle_source = 3 # MIDDLE_AFTER_EDIT');
});

test('an edited cell invalidates a delayed preview response', async ({ page, request }) => {
  await openNotebook(page, request, [
    code('source', 'value = 1 # SOURCE_BEFORE'),
    question('current', 'E2E_BASIC inspect context')
  ]);
  await selectQuestion(page, 1);
  await preview(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let intercepted!: () => void;
  const held = new Promise<void>(resolve => { intercepted = resolve; });
  let delayed = true;
  await page.route('**/nbinlineai/context-preview', async route => {
    if (!delayed) { await route.continue(); return; }
    delayed = false;
    const response = await route.fetch();
    intercepted();
    await gate;
    await route.fulfill({ response }).catch(() => undefined);
  });
  await panel(page).locator('[data-nbinlineai-context-refresh]').click();
  await held;
  await cells(page).first().locator('.cm-content').fill('value = 2 # SOURCE_AFTER');
  await expect(panel(page).locator('[data-nbinlineai-context-report]')).toContainText(/estimate needs updating/i);
  release();
  await expect(panel(page).locator('[data-nbinlineai-context-report]')).toContainText(/estimate needs updating/i);
  await expect(panel(page).locator('[data-nbinlineai-context-status]')).not.toContainText('Context checked:');
  const fresh = await preview(page);
  expect(fresh.request.notebook_cells.find((cell: any) => cell.id === 'source').source).toContain('SOURCE_AFTER');
});

test('separate notebook tabs keep their own target, mode, and preview session', async ({ page, request }) => {
  await openNotebook(page, request, [
    code('first-source', 'first_value = 1'), question('first-question', 'E2E_BASIC first notebook')
  ]);
  await selectQuestion(page, 1);
  await mode(page).selectOption('all-above');
  const first = await preview(page);
  const other = await page.context().newPage();
  try {
    await openNotebook(other, request, [
      code('second-source', 'second_value = 2'), question('second-question', 'E2E_BASIC second notebook')
    ]);
    await selectQuestion(other, 1);
    await mode(other).selectOption('full-notebook');
    const second = await preview(other);
    expect(first.request.session_id).not.toBe(second.request.session_id);
    expect(first.request.prompt_cell_id).toBe('first-question');
    expect(second.request.prompt_cell_id).toBe('second-question');
    expect(first.body.selected_cell_ids).toContain('first-source');
    expect(second.body.selected_cell_ids).toContain('second-source');
    await expect(mode(page)).toHaveValue('all-above');
    await expect(target(page)).toContainText('2');
    const posted = page.waitForRequest(req => req.url().endsWith('/nbinlineai/prompt') && req.method() === 'POST');
    await cells(page).nth(1).locator('[data-nbinlineai-run]').click();
    expect((await posted).postDataJSON()).toMatchObject({
      session_id: first.request.session_id, prompt_cell_id: 'first-question', context_mode: 'all-above'
    });
    await expect(cells(page).nth(1).locator('.nbinlineai-status')).toContainText(/Done|Answer kept/);
  } finally {
    await other.close();
  }
});

test('one Run click on an inactive question queues behind busy Python code', async ({ page, request }) => {
  await openNotebook(page, request, [
    code('setup', 'import time\nprint("BUSY_START", flush=True)\ntime.sleep(2.5)\nready_value = 1'),
    markdown('note', '## Setup note'),
    question('current', 'E2E_BASIC explain the setup')
  ]);
  const setup = cells(page).first();
  await setup.click();
  await page.keyboard.press('Shift+Enter');
  await expect(setup.locator('.jp-OutputArea')).toContainText('BUSY_START');
  const run = cells(page).nth(2).locator('[data-nbinlineai-run]');
  const posted = page.waitForRequest(req => req.url().endsWith('/nbinlineai/prompt') && req.method() === 'POST');
  await run.click();
  await expect(cells(page).nth(2).locator('.nbinlineai-status')).toContainText(/Waiting|Preparing|Done|Answer kept/);
  expect((await posted).postDataJSON().prompt_cell_id).toBe('current');
  await expect(cells(page).nth(2).locator('.nbinlineai-status')).toContainText(/Done|Answer kept/);
});
