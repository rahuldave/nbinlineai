import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '../support/e2e-fixtures';

type NotebookCell = { id: string; cell_type: string; source: string[] };

test('the exact outputs example demonstrates and inspects all ten public tools', async ({ page, request }) => {
  test.setTimeout(180_000);
  const example = JSON.parse(readFileSync(resolve('examples/browser-media-outputs.ipynb'), 'utf8'));
  const cells = example.cells as NotebookCell[];
  const codeIds = cells.filter(cell => cell.cell_type === 'code').map(cell => cell.id);
  const codeCell = (id: string) => {
    const index = codeIds.indexOf(id);
    expect(index, `example code cell ${id}`).toBeGreaterThanOrEqual(0);
    return page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-CodeCell').nth(index);
  };
  const run = async (id: string): Promise<void> => {
    const cell = codeCell(id);
    const prompt = cell.locator('.jp-InputPrompt');
    const before = await prompt.textContent();
    await cell.locator('.cm-content').click();
    await page.keyboard.press('Control+Enter');
    await expect.poll(async () => {
      const current = await prompt.textContent();
      return current !== before && /\[\d+\]/.test(current ?? '');
    }).toBe(true);
  };
  const inspect = async (id: string, accepted: (text: string) => boolean): Promise<string> => {
    let text = '';
    for (let attempt = 0; attempt < 8; attempt++) {
      await run(id);
      text = await codeCell(id).locator('.jp-OutputArea').textContent() ?? '';
      if (accepted(text)) return text;
    }
    expect(accepted(text), `${id} did not show its completed result: ${text.slice(0, 500)}`).toBe(true);
    return text;
  };

  await request.get('/lab');
  const xsrf = (await request.storageState()).cookies.find(cookie => cookie.name === '_xsrf')?.value;
  expect(xsrf).toBeTruthy();
  const name = `browser-media-outputs-example-${Date.now()}.ipynb`;
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

  for (const id of ['outputs-setup', 'output-raster', 'output-text', 'output-vector']) await run(id);
  await run('view-call');
  expect(await inspect('view-inspect', text => text.includes('completed') && text.includes('active_cell_id')))
    .toContain('cell_count');
  await run('selection-call');
  expect(await inspect('selection-inspect', text => text.includes('completed') && text.includes('truncated')))
    .toContain('selection');

  await run('outputs-list-call');
  expect(await inspect('outputs-list-inspect', text => (text.match(/completed/g) ?? []).length >= 3 &&
    text.includes('output-raster') && text.includes('output-text') && text.includes('output-vector')))
    .toContain('outputs');
  await run('output-read-call');
  expect(await inspect('output-read-inspect', text => text.includes('completed') && text.includes('Existing output text')))
    .toContain('Existing output text');
  await run('output-export-call');
  expect(await inspect('output-export-inspect', text => (text.match(/completed/g) ?? []).length >= 2 &&
    text.includes('(8, 8)') && text.includes('True'))).toContain('True');

  await run('output-canvas');
  const canvas = codeCell('output-canvas').locator('.jp-RenderedHTML canvas');
  await expect(canvas).toHaveCount(1);
  await canvas.evaluate((element: HTMLCanvasElement) => {
    const drawing = element.getContext('2d')!;
    drawing.fillStyle = '#e23a1c';
    drawing.fillRect(0, 0, 8, 8);
  });
  await run('canvas-output-list-call');
  expect(await inspect('canvas-output-list-inspect', text => text.includes('completed') && text.includes('output-canvas')))
    .toContain('outputs');
  await run('canvas-list-call');
  expect(await inspect('canvas-list-inspect', text => text.includes('completed') && text.includes('canvases')))
    .toContain('canvases');
  await run('canvas-capture-call');
  expect(await inspect('canvas-capture-inspect', text => text.includes('completed') && text.includes('(8, 8)')))
    .toContain('(8, 8)');
  await run('canvas-export-call');
  expect(await inspect('canvas-export-inspect', text => text.includes('completed') && text.includes('path')))
    .toContain('sha256');
  await run('canvas-start-call');
  expect(await inspect('canvas-start-inspect', text => text.includes('completed') && text.includes('source_id')))
    .toContain('source_id');

  await run('region-raster');
  await run('region-call');
  expect(await inspect('region-inspect', text => text.includes('completed') && text.includes('(')))
    .not.toContain('unsupported');
  await run('outputs-cleanup');
  expect(await inspect('source-stop-inspect', text => text.includes('completed') && text.includes('stopped')))
    .toContain('completed');
});
