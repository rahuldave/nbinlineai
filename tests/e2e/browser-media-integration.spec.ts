import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '../support/e2e-fixtures';

type Cell = { id: string; cell_type: string; source: string[]; execution_count?: number | null; outputs?: unknown[] };

async function copiedExample(page: Page, request: APIRequestContext) {
  const example = JSON.parse(readFileSync(resolve('examples/browser-media-integration.ipynb'), 'utf8'));
  const cells = example.cells as Cell[];
  for (const id of ['integration-preflight-question', 'integration-question']) {
    const question = cells.find(cell => cell.id === id);
    expect(question).toBeTruthy();
    // Only the disposable browser copy calls the deterministic provider fixture.
    question!.source.push('\nE2E_MEDIA_NATIVE_IMAGE');
  }
  const codeCells = cells.filter(cell => cell.cell_type === 'code');
  const codeIds = codeCells.map(cell => cell.id);
  // Remove published outputs only from this copy, so each prompt/count and output comes from this run.
  for (const cell of codeCells) { cell.execution_count = null; cell.outputs = []; }
  await request.get('/lab');
  const xsrf = (await request.storageState()).cookies.find(cookie => cookie.name === '_xsrf')?.value;
  expect(xsrf).toBeTruthy();
  const headers = { 'X-XSRFToken': xsrf! };
  const key = await request.post('/nbinlineai/settings/keys', {
    headers, data: { backend: 'openai_api', key: 'e2e-no-network-openai' }
  });
  expect(key.ok(), await key.text()).toBeTruthy();
  const name = `browser-media-integration-${Date.now()}.ipynb`;
  const uploaded = await request.put(`/api/contents/${name}`, {
    headers, data: { type: 'notebook', format: 'json', content: example }
  });
  expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
  await page.goto(`/lab/workspaces/${name.slice(0, -6)}/tree/${name}`);
  const notebook = page.locator('.jp-NotebookPanel:visible .jp-Notebook');
  await expect(notebook.locator('.jp-CodeCell')).toHaveCount(codeIds.length);
  await expect.poll(async () => {
    const sessions = await request.get('/api/sessions');
    return sessions.ok() && (await sessions.json() as Array<{ path: string; kernel?: { id: string } }>).some(
      session => session.path === name && session.kernel?.id);
  }).toBeTruthy();
  const select = page.getByRole('button', { name: 'Select', exact: true });
  await select.waitFor({ state: 'visible', timeout: 3000 }).catch(() => undefined);
  if (await select.isVisible()) await select.click();
  const no = page.getByRole('button', { name: 'No', exact: true });
  if (await no.isVisible()) await no.click();
  const cell = (id: string) => notebook.locator('.jp-CodeCell').nth(codeIds.indexOf(id));
  const run = async (id: string) => {
    const target = cell(id);
    const prompt = target.locator('.jp-InputPrompt');
    const before = await prompt.textContent();
    await target.locator('.cm-content').click();
    await page.keyboard.press('Control+Enter');
    await expect.poll(async () => {
      const current = await prompt.textContent();
      return current !== before && /\[\d+\]/.test(current ?? '');
    }).toBe(true);
  };
  const inspect = async (id: string, marker: string) => {
    let output = '';
    for (let attempt = 0; attempt < 12; attempt++) {
      await run(id);
      output = await cell(id).locator('.jp-OutputArea').textContent() ?? '';
      if (output.includes(marker)) break;
    }
    expect(output).toContain(marker);
    expect(output).not.toContain('failed');
    return output;
  };
  return { notebook, cell, run, inspect };
}

test('output export, preview, crop and explicit attachment send one exact native image only after Run',
  async ({ page, request }) => {
    const { notebook, cell, run, inspect } = await copiedExample(page, request);
    await run('integration-setup');
    await expect(cell('integration-setup').locator('.jp-OutputArea')).toContainText('Disposable 8x8');
    await run('integration-output');
    await expect(cell('integration-output').locator('.jp-OutputArea img')).toBeVisible();
    const outputExecution = await cell('integration-output').locator('.jp-InputPrompt').textContent();

    await run('integration-list-call');
    const listed = await inspect('integration-list-inspect', 'Output reference:');
    expect(listed).toContain('completed None');
    expect(listed).toContain("'cell_id': 'integration-output'");
    expect(listed).toMatch(/'output_id': '[0-9a-f]{32}'/);
    expect(listed).toContain('image/png');
    await run('integration-export-call');
    await inspect('integration-export-inspect', 'Exported memory hash:');
    const exportExecution = await cell('integration-export-call').locator('.jp-InputPrompt').textContent();
    await run('integration-preview-call');
    await inspect('integration-preview-inspect', 'completed');
    await run('integration-crop-call');
    const cropExecution = await cell('integration-crop-call').locator('.jp-InputPrompt').textContent();
    const cropped = await inspect('integration-crop-inspect', 'Derivative memory hash:');
    const hash = cropped.match(/Derivative memory hash:\s*([0-9a-f]{64})/)?.[1];
    expect(hash).toMatch(/^[0-9a-f]{64}$/);

    // Saving is optional and explicit; the attachment below still uses the memory derivative.
    await run('integration-save-call');
    const savedOutput = await inspect('integration-save-inspect', 'Sidecar path:');
    expect(savedOutput).toContain('Saved path:');
    const saveExecution = await cell('integration-save-call').locator('.jp-InputPrompt').textContent();
    expect(await cell('integration-output').locator('.jp-InputPrompt').textContent()).toBe(outputExecution);

    const preflight = notebook.locator('.nbinlineai-prompt-cell')
      .filter({ hasText: 'Before I confirm any image attachment' });
    await expect(preflight).toHaveCount(1);
    await preflight.locator('[data-nbinlineai-run]').click();
    await expect(preflight.locator('.nbinlineai-status')).toContainText(/Done|Answer kept/);
    await expect(notebook.locator('.nbinlineai-response-cell').filter({ hasText: 'NATIVE_IMAGE count=0' }))
      .toHaveCount(1);

    const question = notebook.locator('.nbinlineai-prompt-cell')
      .filter({ hasText: 'What is the visible color in the four-pixel-square image' });
    await expect(question).toHaveCount(1);
    await expect(question.locator('[data-nbinlineai-attachment]')).toBeHidden();
    await question.locator('.jp-Cell-inputWrapper').click();
    const details = page.locator('.jp-NotebookPanel:visible [data-nbinlineai-context-details]');
    if (await details.getAttribute('open') === null) await details.locator('summary').click();
    const refreshPreview = async () => {
      const response = page.waitForResponse(item => item.url().endsWith('/nbinlineai/context-preview') &&
        item.request().method() === 'POST');
      await page.locator('.jp-NotebookPanel:visible [data-nbinlineai-context-refresh]').click();
      const result = await response;
      expect(result.ok(), await result.text()).toBeTruthy();
      return await result.json() as { context_chars: number; round_wire_chars?: number };
    };
    const beforeAttachment = await refreshPreview();
    expect(beforeAttachment.context_chars).toBeGreaterThan(0);
    expect(beforeAttachment.context_chars).toBeLessThanOrEqual(64_000);
    // Text-only previews do not report round_wire_chars; that metric is present
    // when the confirmed image enters the submission estimate below.
    expect(beforeAttachment.round_wire_chars).toBeUndefined();
    await run('integration-attach-call');
    const confirmation = page.locator('.jp-NotebookPanel:visible .nbinlineai-attachment-confirmation');
    await expect(confirmation).toBeVisible();
    await expect(confirmation.locator('img')).toHaveJSProperty('complete', true);
    await expect(question.locator('.nbinlineai-status')).not.toContainText('Done');
    await confirmation.getByRole('button', { name: 'Attach image' }).click();
    const attachment = await inspect('integration-attach-inspect', 'completed');
    expect(attachment).toContain(hash!);
    const indicator = question.locator('[data-nbinlineai-attachment]');
    await expect(indicator).toContainText('Image attached');
    await expect(question.locator('.nbinlineai-status')).not.toContainText('Done');

    // Repeated previews budget the confirmed image but do not run either code or model work.
    for (let index = 0; index < 2; index++) {
      const report = await refreshPreview();
      expect(report.round_wire_chars).toBeGreaterThan(0);
      expect(report.round_wire_chars).toBeLessThanOrEqual(64_000);
    }
    expect(await cell('integration-output').locator('.jp-InputPrompt').textContent()).toBe(outputExecution);
    expect(await cell('integration-export-call').locator('.jp-InputPrompt').textContent()).toBe(exportExecution);
    expect(await cell('integration-crop-call').locator('.jp-InputPrompt').textContent()).toBe(cropExecution);
    expect(await cell('integration-save-call').locator('.jp-InputPrompt').textContent()).toBe(saveExecution);
    await expect(question.locator('.nbinlineai-status')).not.toContainText('Done');

    await question.locator('[data-nbinlineai-run]').click();
    await expect(question.locator('.nbinlineai-status')).toContainText(/Done|Answer kept/);
    const answer = notebook.locator('.nbinlineai-response-cell').filter({ hasText: 'NATIVE_IMAGE count=1' });
    await expect(answer).toHaveCount(1);
    await expect(answer).toContainText(`sha256=${hash}`);
    await expect(answer).toContainText('mime=image/png');
    await expect(answer).not.toContainText('data:image/png;base64');
    expect(await cell('integration-output').locator('.jp-InputPrompt').textContent()).toBe(outputExecution);
    expect(await cell('integration-export-call').locator('.jp-InputPrompt').textContent()).toBe(exportExecution);
    expect(await cell('integration-crop-call').locator('.jp-InputPrompt').textContent()).toBe(cropExecution);
    expect(await cell('integration-save-call').locator('.jp-InputPrompt').textContent()).toBe(saveExecution);

    await indicator.getByRole('button', { name: 'Remove image' }).click();
    await expect(indicator).toBeHidden();
    await run('integration-close-call');
    await inspect('integration-close-inspect', 'Crop: completed');
    await run('integration-file-cleanup');
    await expect(cell('integration-file-cleanup').locator('.jp-OutputArea'))
      .toContainText('Optional generated file and sidecar removed: True');
  });
