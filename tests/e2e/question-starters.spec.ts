import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const panel = (page: Page) => page.locator('.jp-NotebookPanel:visible');
const cells = (page: Page) => panel(page).locator('.jp-Notebook .jp-Cell');
const starter = (page: Page, index: number, name: string) =>
  cells(page).nth(index).locator(`[data-nbinlineai-starter="${name}"]`);

async function openNotebook(page: Page, request: APIRequestContext) {
  const name = `question-starters-${Date.now()}-${Math.floor(Math.random() * 1e6)}.ipynb`;
  await request.get('/lab');
  const xsrf = (await request.storageState()).cookies.find(cookie => cookie.name === '_xsrf')?.value;
  expect(xsrf).toBeTruthy();
  const response = await request.put(`/api/contents/${name}`, {
    headers: { 'X-XSRFToken': xsrf! },
    data: { type: 'notebook', format: 'json', content: {
      cells: [
        { id: 'note', cell_type: 'markdown', source: '## Prior lesson note\nAn ordinary note.', metadata: {} },
        { id: 'first-question', cell_type: 'markdown', source: '', metadata: { nbinlineai: { isPromptCell: true } } },
        { id: 'second-question', cell_type: 'markdown', source: '   ', metadata: { nbinlineai: { isPromptCell: true } } }
      ],
      metadata: { kernelspec: { display_name: 'Python 3 (ipykernel)', language: 'python', name: 'python3' } },
      nbformat: 4, nbformat_minor: 5
    } }
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  await page.goto(`/lab/workspaces/${name.slice(0, -6)}/tree/${name}`);
  await expect(cells(page)).toHaveCount(3);
  return name;
}

async function savedSource(request: APIRequestContext, name: string, index: number) {
  // A GET can briefly race Jupyter's atomic autosave under the full browser suite.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await request.get(`/api/contents/${name}?content=1`);
    if (response.ok()) return (await response.json()).content.cells[index].source as string;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Notebook contents did not become readable after autosave');
}

test('empty AI questions offer editable starters without running AI or dirtying the notebook on display', async ({ page, request }) => {
  const name = await openNotebook(page, request);
  let providerRequests = 0;
  page.on('request', outgoing => {
    if (outgoing.method() === 'POST' && outgoing.url().includes('/nbinlineai/prompt')) providerRequests += 1;
  });
  const labels = ['Explain cell above', 'Explain code above', 'Explain section above', 'Write code…'];
  await expect(cells(page).nth(1).locator('[data-nbinlineai-starters] button')).toHaveText(labels);
  await expect(cells(page).nth(2).locator('[data-nbinlineai-starters] button')).toHaveText(labels);
  // Kernel startup can update Jupyter's own metadata; save that baseline first.
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.getByText('Saving completed')).toBeVisible();
  await page.reload();
  await expect(cells(page).nth(1).locator('[data-nbinlineai-starters] button')).toHaveText(labels);
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.getByText('Saving completed')).toBeVisible();
  await expect(page.locator('.lm-TabBar-tab.jp-mod-dirty')).toHaveCount(0);
  expect(await savedSource(request, name, 1)).toBe('');
  expect(await savedSource(request, name, 2)).toBe('   ');
  const firstBox = await cells(page).nth(1).boundingBox();
  const lastBox = await cells(page).nth(2).boundingBox();
  expect(firstBox).not.toBeNull();
  expect(lastBox).not.toBeNull();
  await page.screenshot({ path: 'test-results/ai-starters-light.png', clip: {
    x: Math.max(0, firstBox!.x - 4), y: Math.max(0, firstBox!.y - 4),
    width: Math.min(page.viewportSize()!.width - firstBox!.x + 4, firstBox!.width + 8),
    height: lastBox!.y + lastBox!.height - firstBox!.y + 8
  } });

  await cells(page).first().locator('.jp-RenderedHTMLCommon').dblclick();
  await expect(cells(page).first().locator('.cm-content')).toBeVisible();
  await starter(page, 1, 'explain-code').click();
  const first = cells(page).nth(1);
  await expect(first.locator('.cm-content')).toHaveText(
    'Explain the nearest code cell above this question. Use earlier context where helpful.'
  );
  await expect(first.locator('.cm-content')).toBeFocused();
  await expect(first.locator('[data-nbinlineai-starters]')).toBeHidden();
  expect(providerRequests).toBe(0);

  await page.keyboard.press('ControlOrMeta+z');
  await expect(first.locator('.cm-content')).toHaveText('');
  await expect(first.locator('[data-nbinlineai-starters]')).toBeVisible();
  await starter(page, 1, 'write-code').focus();
  await page.keyboard.press('Enter');
  await expect(first.locator('.cm-content')).toHaveText('Write code to ');
  await expect(first.locator('.cm-content')).toBeFocused();
  await page.keyboard.press('ControlOrMeta+s');
  await expect.poll(() => savedSource(request, name, 1)).toBe('Write code to ');
  await page.reload();
  await expect(cells(page).nth(1).locator('.cm-content')).toHaveText('Write code to ');
  await expect(cells(page).nth(1).locator('[data-nbinlineai-starters]')).toBeHidden();
  await expect(cells(page).nth(2).locator('[data-nbinlineai-starters]')).toBeVisible();
  expect(providerRequests).toBe(0);
});
