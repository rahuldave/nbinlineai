import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '../support/e2e-fixtures';

test('shipped live catalog lists real cells from its copied notebook', async ({ page, request }) => {
  await request.get('/lab');
  const xsrf = (await request.storageState()).cookies.find(cookie => cookie.name === '_xsrf')?.value;
  expect(xsrf).toBeTruthy();
  const headers = { 'X-XSRFToken': xsrf! };
  const key = await request.post('/nbinlineai/settings/keys', {
    headers, data: { backend: 'openai_api', key: 'e2e-no-network-openai' }
  });
  expect(key.ok(), await key.text()).toBeTruthy();

  const example = JSON.parse(readFileSync(resolve('examples/tool-catalog-live-notebook.ipynb'), 'utf8'));
  const listing = example.cells.find((cell: any) => cell.id === 'catalog-demo-list_cells');
  expect(listing).toBeTruthy();
  // The deterministic provider marker changes only this disposable uploaded copy.
  listing.source = `${listing.source.join('')}\nE2E_CATALOG_LIST_CELLS`;
  const name = `tool-catalog-live-${Date.now()}.ipynb`;
  const uploaded = await request.put(`/api/contents/${name}`, {
    headers, data: { type: 'notebook', format: 'json', content: example }
  });
  expect(uploaded.ok(), await uploaded.text()).toBeTruthy();

  await page.goto(`/lab/workspaces/${name.slice(0, -6)}/tree/${name}`);
  const notebook = page.locator('.jp-NotebookPanel:visible .jp-Notebook');
  await expect.poll(async () => {
    const sessions = await request.get('/api/sessions');
    return sessions.ok() && (await sessions.json()).some((session: any) =>
      session.path === name && session.kernel?.id);
  }).toBeTruthy();
  const setup = notebook.locator('[data-cell-id="catalog-live-setup"]');
  await setup.click();
  await page.keyboard.press('Shift+Enter');
  await expect(setup.locator('.jp-OutputArea')).toContainText('Live notebook tools imported');

  const prompt = notebook.locator('[data-cell-id="catalog-demo-list_cells"]');
  await expect(prompt).toContainText('list_cells');
  await prompt.locator('[data-nbinlineai-run]').click();
  await expect(prompt.locator('.nbinlineai-status')).toContainText(/Done|Answer kept/);
  const answer = notebook.locator('.nbinlineai-response-cell').first();
  await expect(answer).toContainText('catalog-demo-list_cells');
  await expect(answer).toContainText('catalog-demo-read_cell');
  await expect(notebook.locator('[data-cell-id="catalog-scratch-replace"] .cm-content'))
    .toContainText('catalog_marker_replace = 1');
});
