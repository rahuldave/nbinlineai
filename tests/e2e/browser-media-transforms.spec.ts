import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '../support/e2e-fixtures';

test('the public notebook decodes two real video frames and saves and redacts PNG derivatives', async ({ page, request }) => {
  const example = JSON.parse(await readFile(join(process.cwd(), 'examples/browser-media-transforms.ipynb'), 'utf8'));
  const ids = example.cells.filter((cell: { cell_type: string }) => cell.cell_type === 'code')
    .map((cell: { id: string }) => cell.id);
  expect(ids).toEqual([
    'transform-setup', 'transform-frames-call', 'transform-frames-inspect',
    'transform-crop-call', 'transform-crop-inspect', 'transform-annotate-call',
    'transform-annotate-inspect', 'transform-cleanup'
  ]);
  const name = `transform-example-${Date.now()}.ipynb`;
  await request.get('/lab');
  const xsrf = (await request.storageState()).cookies.find(cookie => cookie.name === '_xsrf')?.value;
  expect(xsrf).toBeTruthy();
  const uploaded = await request.put(`/api/contents/${name}`, {
    headers: { 'X-XSRFToken': xsrf! }, data: { type: 'notebook', format: 'json', content: example }
  });
  expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
  await page.goto(`/lab/workspaces/${name.slice(0, -6)}/tree/${name}`);
  const code = page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-CodeCell');
  await expect(code).toHaveCount(ids.length);
  const selectKernel = page.getByRole('button', { name: 'Select', exact: true });
  await selectKernel.waitFor({ state: 'visible', timeout: 3000 }).catch(() => undefined);
  if (await selectKernel.isVisible().catch(() => false)) await selectKernel.click();
  const newsNo = page.getByRole('button', { name: 'No', exact: true });
  if (await newsNo.isVisible().catch(() => false)) await newsNo.click();
  await expect.poll(async () => (await (await request.get('/api/sessions')).json() as Array<{
    path: string; kernel?: { id?: string }
  }>).some(session => session.path === name && !!session.kernel?.id)).toBeTruthy();

  async function run(index: number): Promise<string> {
    const cell = code.nth(index);
    const prompt = cell.locator('.jp-InputPrompt');
    const before = await prompt.textContent();
    await cell.locator('.cm-content').click();
    await page.keyboard.press('Control+Enter');
    await expect.poll(() => prompt.textContent()).not.toBe(before);
    await expect(prompt).not.toContainText('*');
    return await cell.locator('.jp-OutputArea').textContent() ?? '';
  }
  async function inspect(index: number, evidence: string): Promise<void> {
    let output = '';
    for (let attempt = 0; attempt < 15; attempt++) {
      output = await run(index);
      if (output.includes(evidence)) return;
      await page.waitForTimeout(300);
    }
    expect(output).toContain(evidence);
  }

  expect(await run(0)).toContain('Disposable exact PNG');
  await run(1);
  await inspect(2, 'Verified decoded red and blue frames:');
  await run(3);
  await inspect(4, 'crop.png.json');
  await run(5);
  await inspect(6, 'Opaque redaction changed derivative pixels; source stayed red');
  expect(await run(7)).toContain('Disposable transform files removed');
});
