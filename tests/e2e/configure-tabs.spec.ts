import { expect, test } from '../support/e2e-fixtures';

test('Configure AI groups connection setup and user defaults in keyboard-accessible tabs', async ({ page, request }) => {
  await request.get('/lab');
  const xsrf = (await request.storageState()).cookies.find(cookie => cookie.name === '_xsrf')?.value;
  expect(xsrf).toBeTruthy();
  const name = `configure-tabs-${Date.now()}.ipynb`;
  const created = await request.put(`/api/contents/${name}`, {
    headers: { 'X-XSRFToken': xsrf! },
    data: { type: 'notebook', format: 'json', content: {
      cells: [{ id: 'setup', cell_type: 'code', source: 'value = 1', metadata: {}, outputs: [], execution_count: null }],
      metadata: { kernelspec: { display_name: 'Python 3 (ipykernel)', language: 'python', name: 'python3' } },
      nbformat: 4, nbformat_minor: 5
    } }
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  await page.goto(`/lab/workspaces/${name.slice(0, -6)}/tree/${name}`);
  await expect(page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-CodeCell')).toHaveCount(1);
  await page.getByRole('button', { name: 'Configure AI' }).first().click();

  const dialog = page.locator('[data-nbinlineai-keys-dialog]');
  const connections = dialog.getByRole('tab', { name: 'Connections & models' });
  const defaults = dialog.getByRole('tab', { name: 'Defaults' });
  const connectionPanel = dialog.getByRole('tabpanel', { name: 'Connections & models' });
  const defaultsPanel = dialog.getByRole('tabpanel', { name: 'Defaults' });
  await expect(connections).toHaveAttribute('aria-selected', 'true');
  await expect(connectionPanel).toBeVisible();
  await expect(defaultsPanel).toBeHidden();
  await expect(connectionPanel).toContainText('Switching connections here only shows setup');

  await connectionPanel.locator('[data-nbinlineai-connection]').selectOption('anthropic_api');
  await expect(connectionPanel.locator('[data-nbinlineai-key-provider="anthropic_api"]')).toBeVisible();
  await expect(connectionPanel.locator('[data-nbinlineai-key-provider="openai_api"]')).toBeHidden();
  await expect(dialog.locator('[data-nbinlineai-default-backend]')).toBeHidden();

  await connections.focus();
  await expect(connections).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(defaults).toBeFocused();
  await expect(defaults).toHaveAttribute('aria-selected', 'true');
  await expect(defaultsPanel).toBeVisible();
  await expect(connectionPanel).toBeHidden();
  await expect(defaultsPanel.locator('[data-nbinlineai-default-backend]')).toBeVisible();
  await expect(defaultsPanel.locator('[data-nbinlineai-prompt-mode]')).toBeVisible();
  await expect(defaultsPanel.locator('[data-nbinlineai-template-details]')).toBeVisible();

  await page.keyboard.press('Home');
  await expect(connections).toBeFocused();
  await expect(connectionPanel).toBeVisible();
  await expect(connectionPanel.locator('[data-nbinlineai-connection]')).toHaveValue('anthropic_api');
  await page.keyboard.press('Tab');
  await expect(connectionPanel).toBeFocused();
  await page.getByRole('button', { name: 'Done' }).click();
});
