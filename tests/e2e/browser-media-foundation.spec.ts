import { expect, test, type APIRequestContext, type Page } from '../support/e2e-fixtures';

async function open(page: Page, request: APIRequestContext, source: string): Promise<string> {
  const name = `media-${Date.now()}-${Math.floor(Math.random() * 100000)}.ipynb`;
  await request.get('/lab');
  const xsrf = (await request.storageState()).cookies.find(cookie => cookie.name === '_xsrf')?.value;
  expect(xsrf).toBeTruthy();
  const response = await request.put(`/api/contents/${name}`, { headers: { 'X-XSRFToken': xsrf! },
    data: { type: 'notebook', format: 'json', content: { cells: [
      { id: 'start', cell_type: 'code', source, metadata: {}, outputs: [], execution_count: null },
      { id: 'check', cell_type: 'code', source: "print(r.status, type(r.result).__name__, r.result.size if r.result else None, r.media.get('path') if r.media else None)", metadata: {}, outputs: [], execution_count: null }
    ], metadata: { kernelspec: { display_name: 'Python 3 (ipykernel)', language: 'python', name: 'python3' } },
      nbformat: 4, nbformat_minor: 5 } } });
  expect(response.ok(), await response.text()).toBeTruthy();
  await page.goto(`/lab/workspaces/${name.slice(0, -6)}/tree/${name}?nbinlineai_media_fixture=1`);
  await expect(page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-CodeCell')).toHaveCount(2);
  const selectKernel = page.getByRole('button', { name: 'Select', exact: true });
  if (await selectKernel.isVisible().catch(() => false)) await selectKernel.click();
  const newsNo = page.getByRole('button', { name: 'No', exact: true });
  if (await newsNo.isVisible().catch(() => false)) await newsNo.click();
  return name;
}

test('execution-bound receipt receives PNG bytes after a busy kernel without implicit save', async ({ page, request }) => {
  const name = await open(page, request,
    "from nbinlineai.browser_receipt import request_browser_operation\nr = request_browser_operation('fixture_image', {'save_to': None})\nimport time; time.sleep(5)\nprint(r)");
  const cells = page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-CodeCell');
  await cells.first().click();
  await page.keyboard.press('Shift+Enter');
  await expect(page.locator('.nbinlineai-media-status')).toContainText('Media completed');
  await page.waitForTimeout(5500); // Let the busy kernel finish and process its queued comm.
  await cells.nth(1).click();
  await page.keyboard.press('Shift+Enter');
  await expect(cells.nth(1).locator('.jp-OutputArea')).toContainText('completed PngImageFile (2, 2) None');
  const listing = await (await request.get('/api/contents?content=1')).json();
  expect(listing.content.some((item: { name: string }) => item.name === 'media')).toBeFalsy();
  expect(name).toMatch(/\.ipynb$/);
});

test('server saves the exact PNG while the kernel is busy', async ({ page, request }) => {
  await open(page, request,
    "from nbinlineai.browser_receipt import request_browser_operation\nr = request_browser_operation('fixture_image', {'save_to': 'auto'})\nimport time; time.sleep(5)\nprint(r)");
  const cells = page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-CodeCell');
  await cells.first().click();
  await page.keyboard.press('Shift+Enter');
  await expect(page.locator('.nbinlineai-media-status')).toContainText('Media completed');
  await expect(cells.first().locator('.jp-InputPrompt')).toContainText('*');
  await page.waitForTimeout(5500);
  await cells.nth(1).click();
  await page.keyboard.press('Shift+Enter');
  await expect(cells.nth(1).locator('.jp-OutputArea')).toContainText('completed PngImageFile (2, 2) media/');
  const media = await (await request.get('/api/contents/media?content=1')).json();
  expect(media.content).toHaveLength(1);
  const file = media.content[0];
  const saved = await (await request.get(`/api/contents/media/${file.name}?content=1`)).json();
  expect(saved.format).toBe('base64');
  expect(saved.content.length).toBeGreaterThan(20);
});

test('declared model tool receives bounded capability JSON through action reply', async ({ page, request }) => {
  await request.get('/lab');
  const xsrf = (await request.storageState()).cookies.find(cookie => cookie.name === '_xsrf')?.value;
  expect(xsrf).toBeTruthy();
  const key = await request.post('/nbinlineai/settings/keys', { headers: { 'X-XSRFToken': xsrf! },
    data: { backend: 'openai_api', key: 'e2e-no-network-openai' } });
  expect(key.ok(), await key.text()).toBeTruthy();
  const name = `media-model-${Date.now()}.ipynb`;
  const created = await request.put(`/api/contents/${name}`, { headers: { 'X-XSRFToken': xsrf! },
    data: { type: 'notebook', format: 'json', content: { cells: [
      { id: 'setup', cell_type: 'code', source: 'from nbinlineai.tools import browser_capabilities', metadata: {}, outputs: [], execution_count: null },
      { id: 'ask', cell_type: 'markdown', source: 'E2E_MEDIA_CAPABILITIES &`browser_capabilities`',
        metadata: { nbinlineai: { isPromptCell: true } } }
    ], metadata: { kernelspec: { display_name: 'Python 3 (ipykernel)', language: 'python', name: 'python3' } },
      nbformat: 4, nbformat_minor: 5 } } });
  expect(created.ok(), await created.text()).toBeTruthy();
  await page.goto(`/lab/workspaces/${name.slice(0, -6)}/tree/${name}`);
  const selectKernel = page.getByRole('button', { name: 'Select', exact: true });
  if (await selectKernel.isVisible().catch(() => false)) await selectKernel.click();
  const newsNo = page.getByRole('button', { name: 'No', exact: true });
  if (await newsNo.isVisible().catch(() => false)) await newsNo.click();
  const notebook = page.locator('.jp-NotebookPanel:visible .jp-Notebook');
  const setup = notebook.locator('.jp-CodeCell').first();
  await expect(notebook.locator('.nbinlineai-prompt-cell')).toHaveCount(1);
  await expect.poll(async () => {
    const sessions = await request.get('/api/sessions');
    return sessions.ok() && (await sessions.json()).some(
      (session: { path: string; kernel?: { id?: string } }) => session.path === name && session.kernel?.id
    );
  }).toBeTruthy();
  await setup.locator('.cm-content').click();
  await page.keyboard.press('Shift+Enter');
  await expect(setup.locator('.jp-InputPrompt')).toContainText('1');
  await notebook.locator('.nbinlineai-prompt-cell [data-nbinlineai-run]').click();
  await expect(notebook.locator('.nbinlineai-response-cell')).toContainText('MEDIA_CAPABILITIES');
  await expect(notebook.locator('.nbinlineai-response-cell')).toContainText('secure_context');
});

test('operation_status returns one running snapshot without waiting for target completion', async ({ page, request }) => {
  await open(page, request,
    "from nbinlineai.browser_receipt import request_browser_operation\nr = request_browser_operation('fixture_pending', {})");
  const cells = page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-CodeCell');
  await cells.first().locator('.cm-content').click();
  await page.keyboard.press('Shift+Enter');
  await expect(page.locator('.nbinlineai-media-status')).toContainText('Media running');
  await cells.nth(1).locator('.cm-content').fill(
    'from nbinlineai.tools import operation_status\ns = operation_status(r.operation_id)'
  );
  await cells.nth(1).locator('.cm-content').click();
  await page.keyboard.press('Shift+Enter');
  await expect(cells.nth(1).locator('.jp-InputPrompt')).toContainText('2');
  await page.waitForTimeout(800);
  await cells.nth(1).locator('.cm-content').fill("print(s.status, s.result['status'])");
  await cells.nth(1).locator('.cm-content').click();
  await page.keyboard.press('Shift+Enter');
  await expect(cells.nth(1).locator('.jp-OutputArea')).toContainText('completed running');
});

test('operation routes reject a second browser client and a known ID without owner proof', async ({ page, request }) => {
  const name = await open(page, request, 'pass');
  const sessions = await (await request.get('/api/sessions')).json() as Array<{ id: string; path: string }>;
  const sessionId = sessions.find(session => session.path === name)?.id;
  expect(sessionId).toBeTruthy();
  const xsrf = (await request.storageState()).cookies.find(cookie => cookie.name === '_xsrf')?.value;
  const identity = { session_id: sessionId, model_id: 'model-one', client_id: 'browser-one' };
  const ownerResponse = await request.post('/nbinlineai/browser-media/owner', {
    headers: { 'X-XSRFToken': xsrf! }, data: identity
  });
  expect(ownerResponse.ok(), await ownerResponse.text()).toBeTruthy();
  const owner = await ownerResponse.json() as { owner_secret: string };
  const create = await request.post('/nbinlineai/browser-media/create', {
    headers: { 'X-XSRFToken': xsrf!, 'X-NBInlineAI-Owner': owner.owner_secret },
    data: { ...identity, request_id: 'one', name: 'fixture_image', arguments: {} }
  });
  expect(create.ok(), await create.text()).toBeTruthy();
  const operationId = (await create.json()).operation_id as string;
  const stolen = await request.post('/nbinlineai/browser-media/status', {
    headers: { 'X-XSRFToken': xsrf! }, data: { ...identity, operation_id: operationId }
  });
  expect(stolen.status()).toBe(409);
  const otherClient = await request.post('/nbinlineai/browser-media/status', {
    headers: { 'X-XSRFToken': xsrf!, 'X-NBInlineAI-Owner': owner.owner_secret },
    data: { ...identity, client_id: 'browser-two', operation_id: operationId }
  });
  expect(otherClient.status()).toBe(409);
  const own = await request.post('/nbinlineai/browser-media/status', {
    headers: { 'X-XSRFToken': xsrf!, 'X-NBInlineAI-Owner': owner.owner_secret },
    data: { ...identity, operation_id: operationId }
  });
  expect(own.ok(), await own.text()).toBeTruthy();
});
