import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '../support/e2e-fixtures';

test('shipped bundled-tools notebook imports a read-only tool and returns its real kernel result', async ({ page, request }) => {
  await request.get('/lab');
  const xsrf = (await request.storageState()).cookies.find(cookie => cookie.name === '_xsrf')?.value;
  expect(xsrf).toBeTruthy();
  const headers = { 'X-XSRFToken': xsrf! };
  const key = await request.post('/nbinlineai/settings/keys', {
    headers, data: { backend: 'openai_api', key: 'e2e-no-network-openai' }
  });
  expect(key.ok(), await key.text()).toBeTruthy();

  const example = JSON.parse(readFileSync(resolve('examples/bundled-tools.ipynb'), 'utf8'));
  const codeCells = example.cells.filter((cell: any) => cell.cell_type === 'code');
  expect(codeCells.map((cell: any) => cell.id).slice(0, 2)).toEqual([
    'bundled-setup', 'bundled-reference-generator'
  ]);
  expect(codeCells).toHaveLength(3);
  const draft = codeCells[2];
  expect(draft.source).toContain('for name in sorted(study_roster_marker)');
  expect(draft.source).toContain('print(name)');
  expect(draft.execution_count).toBeNull();
  expect(draft.outputs).toEqual([]);
  const draftQuestion = example.cells.findIndex((cell: any) => cell.id === 'bundled-code-draft-question');
  const draftTrace = example.cells.findIndex((cell: any) => cell.id === 'worked-trace-bundled-code-draft-question');
  const draftIndex = example.cells.findIndex((cell: any) => cell.id === draft.id);
  expect(draftQuestion).toBeGreaterThanOrEqual(0);
  expect(draftTrace).toBeGreaterThan(draftQuestion);
  expect(draftIndex).toBeGreaterThan(draftTrace);
  expect(example.cells[draftTrace].metadata.nbinlineaiWorkedEvidence.observedTools).toContainEqual({
    name: 'insert_code', resultState: 'completed', frontendAction: true
  });
  for (const cell of codeCells.slice(0, 2)) { cell.execution_count = null; cell.outputs = []; }
  // The published notebook keeps real ChatGPT answers. Rerun only this copied
  // question through the deterministic provider to verify a fresh tool result.
  example.metadata.nbinlineai.defaults.backend = 'openai_api';
  const namesQuestion = example.cells.find((cell: any) => cell.id === 'bundled-names-prompt');
  expect(namesQuestion).toBeTruthy();
  namesQuestion.metadata.nbinlineai.keepAnswer = false;
  const fixture = JSON.parse(readFileSync(resolve('examples/data/ecosystem-lesson.ipynb'), 'utf8'));
  const directory = await request.put('/api/contents/data', {
    headers, data: { type: 'directory' }
  });
  expect(directory.ok(), await directory.text()).toBeTruthy();
  const uploadedFixture = await request.put('/api/contents/data/ecosystem-lesson.ipynb', {
    headers, data: { type: 'notebook', format: 'json', content: fixture }
  });
  expect(uploadedFixture.ok(), await uploadedFixture.text()).toBeTruthy();
  const name = `bundled-tools-${Date.now()}.ipynb`;
  const uploaded = await request.put(`/api/contents/${name}`, {
    headers, data: { type: 'notebook', format: 'json', content: example }
  });
  expect(uploaded.ok(), await uploaded.text()).toBeTruthy();

  await page.goto(`/lab/workspaces/${name.slice(0, -6)}/tree/${name}`);
  await page.setViewportSize({ width: 1500, height: 1200 });
  const panel = page.locator('.jp-NotebookPanel:visible');
  const notebook = panel.locator('.jp-Notebook');
  await expect(notebook.locator('.jp-CodeCell')).toHaveCount(3);
  await expect(notebook.locator('.nbinlineai-prompt-cell')).toHaveCount(
    example.cells.filter((cell: any) => cell.metadata?.nbinlineai?.isPromptCell).length
  );
  await expect.poll(async () => {
    const sessions = await request.get('/api/sessions');
    return sessions.ok() && (await sessions.json()).some((session: any) => session.path === name && session.kernel?.id);
  }).toBeTruthy();

  const setup = notebook.locator('.jp-CodeCell').first();
  await setup.click();
  await page.keyboard.press('Shift+Enter');
  await expect(setup.locator('.jp-OutputArea')).toContainText('Saved fixture: data/ecosystem-lesson.ipynb');
  const generated = notebook.locator('.jp-CodeCell').nth(1);
  await generated.click();
  await page.keyboard.press('Shift+Enter');
  await expect(generated.locator('.jp-OutputArea')).toContainText('&`search_kernel_names`');
  await expect(generated.locator('.jp-OutputArea')).toContainText('&`read_notebook_cell`');
  const insertedDraft = notebook.locator('.jp-CodeCell').nth(2);
  await expect(insertedDraft.locator('.cm-content')).toContainText('for name in sorted(study_roster_marker)');
  const unrunPrompt = await insertedDraft.locator('.jp-InputPrompt').textContent();
  expect(unrunPrompt).not.toMatch(/\[\d+\]/);

  const prompt = notebook.locator('.nbinlineai-prompt-cell').first();
  await expect(prompt).toContainText('search_kernel_names');
  await expect(prompt.locator('[data-nbinlineai-keep-answer]')).not.toBeChecked();
  await expect(prompt.locator('[data-nbinlineai-run]')).toBeEnabled();
  const posted = page.waitForRequest(item => item.url().endsWith('/nbinlineai/prompt') && item.method() === 'POST');
  await prompt.locator('[data-nbinlineai-run]').click();
  const body = (await posted).postDataJSON();
  expect(body.backend).toBe('openai_api');
  expect(body.prompt).not.toContain('&`search_kernel_names`');
  expect(body.snapshot_version).toBe(1);
  expect(body.notebook_cells.some((cell: any) => cell.source.includes('&`search_kernel_names`') && cell.cell_type === 'markdown')).toBeTruthy();
  await expect(prompt.locator('.nbinlineai-status')).toContainText(/Done|Answer kept/);
  const answer = notebook.locator('.nbinlineai-response-cell');
  await expect(answer.locator('.jp-RenderedHTMLCommon')).toContainText('study_roster_marker');
  await expect(answer.locator('.jp-RenderedHTMLCommon')).toContainText('built-in found');
  expect(await insertedDraft.locator('.jp-InputPrompt').textContent()).toBe(unrunPrompt);
});
