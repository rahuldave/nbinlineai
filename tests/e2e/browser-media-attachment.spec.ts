import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '../support/e2e-fixtures';

type NotebookCell = { id: string; cell_type: string; execution_count?: number | null; outputs?: unknown[] };

async function copiedExample(page: Page, request: APIRequestContext) {
  const example = JSON.parse(readFileSync(resolve('examples/browser-media-attachment.ipynb'), 'utf8'));
  const codeCells = (example.cells as NotebookCell[]).filter(cell => cell.cell_type === 'code');
  const codeIds = codeCells.map(cell => cell.id);
  // The published notebook has saved results. This disposable copy must prove fresh execution.
  for (const cell of codeCells) { cell.execution_count = null; cell.outputs = []; }
  await request.get('/lab');
  const xsrf = (await request.storageState()).cookies.find(cookie => cookie.name === '_xsrf')?.value;
  expect(xsrf).toBeTruthy();
  const name = `browser-media-attachment-example-${Date.now()}.ipynb`;
  const uploaded = await request.put(`/api/contents/${name}`, {
    headers: { 'X-XSRFToken': xsrf! }, data: { type: 'notebook', format: 'json', content: example }
  });
  expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
  await page.goto(`/lab/workspaces/${name.slice(0, -6)}/tree/${name}`);
  await expect(page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-CodeCell')).toHaveCount(codeIds.length);
  const select = page.getByRole('button', { name: 'Select', exact: true });
  await select.waitFor({ state: 'visible', timeout: 3000 }).catch(() => undefined);
  if (await select.isVisible()) await select.click();
  const no = page.getByRole('button', { name: 'No', exact: true });
  if (await no.isVisible()) await no.click();
  const cell = (id: string) => page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-CodeCell')
    .nth(codeIds.indexOf(id));
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
  return { cell, run };
}

test('the exact attachment notebook confirms one image without running the question, then removes it',
  async ({ page, request }) => {
    const { cell, run } = await copiedExample(page, request);
    await run('attachment-setup');
    await expect(cell('attachment-setup').locator('.jp-OutputArea')).toContainText('Disposable exact image:');
    await expect(cell('attachment-setup').locator('.jp-OutputArea')).toContainText('Image exists: True');
    await run('attachment-call');
    const confirmation = page.locator('.jp-NotebookPanel:visible .nbinlineai-attachment-confirmation');
    await expect(confirmation).toBeVisible();
    await expect(confirmation.locator('img')).toBeVisible();
    await expect(confirmation.locator('img')).toHaveJSProperty('complete', true);
    await confirmation.getByRole('button', { name: 'Attach image' }).click();
    const indicator = page.locator('.jp-NotebookPanel:visible [data-nbinlineai-attachment]')
      .filter({ hasText: 'Image attached' });
    await expect(indicator).toBeVisible();
    await expect(indicator).toContainText('saved; checked when run');
    const question = page.locator('.jp-NotebookPanel:visible .nbinlineai-prompt-cell')
      .filter({ hasText: 'What color is the small square' });
    await expect(question).toHaveCount(1);
    await expect(question.locator('.nbinlineai-status')).not.toContainText('Done');
    let receipt = '';
    for (let attempt = 0; attempt < 8; attempt++) {
      await run('attachment-inspect');
      receipt = await cell('attachment-inspect').locator('.jp-OutputArea').textContent() ?? '';
      if (receipt.includes('completed') && receipt.includes('attachment-question')) break;
    }
    expect(receipt).toContain('completed');
    expect(receipt).toContain('attachment-question');
    expect(receipt).toContain('image_sha256');
    await indicator.getByRole('button', { name: 'Remove image' }).click();
    await expect(indicator).toBeHidden();
    await run('attachment-cleanup');
    await expect(cell('attachment-cleanup').locator('.jp-OutputArea')).toContainText('Disposable image removed: True');
  });
