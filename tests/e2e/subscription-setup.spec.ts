import { APIRequestContext, expect, test, Page } from '@playwright/test';

type ConnectionState = 'signed_out' | 'connecting' | 'connected' | 'expired' | 'limited';
const models = [
  { id: 'gpt-6-sol', display_name: 'GPT 6 Sol', efforts: ['medium', 'high'], default_effort: 'medium' },
  { id: 'gpt-6-luna', display_name: 'GPT 6 Luna', efforts: ['low', 'medium'], default_effort: 'medium' }
];

async function mockSubscription(page: Page) {
  let state: ConnectionState = 'signed_out';
  let scope: 'project' | 'notebook' = 'project';
  let offeredModels = models;
  let loginMethod: string | null = null;
  let loginCancelCount = 0;
  let disconnectCount = 0;
  const status = () => ({
    state,
    configured: state === 'connected' || state === 'limited',
    account: state === 'connected' || state === 'limited'
      ? { display_name: 'Sample student', workspace: 'Class workspace' } : undefined,
    models: state === 'connected' || state === 'limited' ? offeredModels : [],
    usage: { state: 'available', remaining_percent: 60 },
    project_root: '/synthetic/course',
    working_folder: '/synthetic/course/week2',
    file_access: scope,
    native_files_capable: false
  });
  await page.context().route('https://example.test/**', route => route.fulfill({
    contentType: 'text/html', body: '<title>Sample ChatGPT sign-in</title>'
  }));
  await page.route('**/nbinlineai/status', async route => {
    const original = await route.fetch();
    const data = await original.json();
    const connected = state === 'connected' || state === 'limited';
    data.subscription_capable = true;
    data.providers.openai_codex_subscription = {
      configured: connected, source: null, state,
      default_model: connected ? offeredModels[0]?.id || null : null,
      models: connected ? offeredModels.map(model => model.id) : []
    };
    data.model_capabilities.openai_codex_subscription = connected
      ? Object.fromEntries(offeredModels.map(model => [model.id, { efforts: model.efforts, default_effort: model.default_effort }]))
      : {};
    await route.fulfill({ response: original, json: data });
  });
  await page.route('**/nbinlineai/subscription/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname.slice(url.pathname.indexOf('/subscription/') + '/subscription/'.length);
    const method = route.request().method();
    let result: object = {};
    if (path === 'status' && method === 'GET') result = status();
    else if (path === 'login' && method === 'POST') {
      loginMethod = route.request().postDataJSON().method;
      state = 'connecting';
      result = loginMethod === 'browser'
        ? { login_id: 'sample-login', state, auth_url: 'https://example.test/auth' }
        : { login_id: 'sample-login', state, device_code: 'SAMPLE-CODE', verification_url: 'https://example.test/device' };
    } else if (path === 'login/cancel' && method === 'POST') {
      loginCancelCount += 1; state = 'signed_out'; result = { cancelled: true };
    } else if (path === 'disconnect' && method === 'POST') {
      disconnectCount += 1; state = 'signed_out'; result = { disconnected: true };
    } else if (path === 'usage' && method === 'GET') result = status().usage;
    else if (path === 'file-access' && method === 'GET') result = { file_access: scope };
    else if (path === 'file-access' && method === 'POST') {
      scope = route.request().postDataJSON().scope; result = { file_access: scope };
    } else throw new Error(`Unexpected subscription request: ${method} ${path}`);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
  });
  return {
    setState(value: ConnectionState) { state = value; },
    setModels(value: typeof models) { offeredModels = value; },
    get loginMethod() { return loginMethod; },
    get loginCancelCount() { return loginCancelCount; },
    get disconnectCount() { return disconnectCount; }
  };
}

async function createNotebook(request: APIRequestContext, name: string, xsrf: string) {
  const response = await request.put(`/api/contents/${name}`, {
    headers: { 'X-XSRFToken': xsrf },
    data: { type: 'notebook', format: 'json', content: {
      cells: [{ id: 'setup', cell_type: 'code', source: 'value = 1', metadata: {}, outputs: [], execution_count: null }],
      metadata: {
        kernelspec: { display_name: 'Python 3 (ipykernel)', language: 'python', name: 'python3' },
        nbinlineai: { defaults: { backend: 'openai_codex_subscription', model: 'gpt-6-sol' } }
      },
      nbformat: 4, nbformat_minor: 5
    } }
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

test('ChatGPT setup keeps sign-in and status read-only until explicit notebook use', async ({ page, request }) => {
  const fake = await mockSubscription(page);
  await request.get('/lab');
  const xsrf = (await request.storageState()).cookies.find(cookie => cookie.name === '_xsrf')?.value;
  expect(xsrf).toBeTruthy();
  const name = `subscription-setup-${Date.now()}.ipynb`;
  await createNotebook(request, name, xsrf!);
  await page.goto(`/lab/workspaces/${name.slice(0, -6)}/tree/${name}`);
  const panel = page.locator('.jp-NotebookPanel:visible');
  await panel.locator('.jp-CodeCell').first().click();
  await page.getByRole('button', { name: 'AI Prompt' }).click();
  await expect(panel.locator('.jp-Cell.nbinlineai-prompt-cell')).toBeVisible();
  await page.keyboard.press('Meta+s');
  await expect(page.getByText('Saving completed')).toBeVisible();
  await expect(page.locator('.lm-TabBar-tab.jp-mod-dirty')).toHaveCount(0);

  await page.getByRole('button', { name: 'Configure AI' }).first().click();
  const dialog = page.locator('[data-nbinlineai-keys-dialog]');
  await dialog.locator('[data-nbinlineai-connection]').selectOption('openai_codex_subscription');
  const setup = dialog.locator('[data-nbinlineai-subscription-setup]');
  await expect(setup).toBeVisible();
  await expect(setup).toContainText('Connect your ChatGPT account');
  await expect(page.locator('.lm-TabBar-tab.jp-mod-dirty')).toHaveCount(0);

  const popupPromise = page.waitForEvent('popup');
  await setup.locator('[data-nbinlineai-subscription-action="login"]').click();
  const popup = await popupPromise;
  await expect(popup).toHaveTitle('Sample ChatGPT sign-in');
  expect(fake.loginMethod).toBe('browser');
  await expect(setup).toContainText('Waiting for ChatGPT sign-in');
  await expect(page.locator('.lm-TabBar-tab.jp-mod-dirty')).toHaveCount(0);
  await setup.locator('[data-nbinlineai-subscription-action="cancel-login"]').click();
  await expect(setup).toContainText('ChatGPT sign-in cancelled');
  expect(fake.loginCancelCount).toBe(1);

  await setup.locator('[data-nbinlineai-subscription-action="device-login"]').click();
  await expect(setup).toContainText('SAMPLE-CODE');
  expect(fake.loginMethod).toBe('device');
  await setup.locator('[data-nbinlineai-subscription-action="cancel-login"]').click();
  await expect(setup).toContainText('ChatGPT sign-in cancelled');
  expect(fake.loginCancelCount).toBe(2);
  await expect(page.locator('.lm-TabBar-tab.jp-mod-dirty')).toHaveCount(0);

  fake.setState('connected');
  await setup.locator('[data-nbinlineai-subscription-action="refresh"]').click();
  await expect(setup).toContainText('Sample student');
  await expect(setup.locator('[data-nbinlineai-subscription-model]')).toHaveValue('gpt-6-sol');
  await expect(setup).toContainText('60% remaining');
  await expect(setup.locator('[data-nbinlineai-subscription-scope]')).toBeHidden();
  await expect(setup).toContainText('Notebook tools only');
  await expect(setup).toContainText('Applies to direct ChatGPT operations. Python keeps its normal permissions.');
  await expect(setup).toContainText('Notebook folder: /synthetic/course/week2');
  await expect(page.locator('.lm-TabBar-tab.jp-mod-dirty')).toHaveCount(0);

  const model = setup.locator('[data-nbinlineai-subscription-model]');
  await model.selectOption('gpt-6-luna');
  await setup.locator('[data-nbinlineai-subscription-effort]').selectOption('low');
  fake.setModels(models.slice(0, 1));
  await setup.locator('[data-nbinlineai-subscription-action="refresh"]').click();
  await expect(model.locator('option[value="gpt-6-luna"]')).toContainText('unavailable');
  await expect(setup.locator('[data-nbinlineai-subscription-action="use"]')).toBeDisabled();
  fake.setModels(models);
  await setup.locator('[data-nbinlineai-subscription-action="refresh"]').click();
  await expect(setup.locator('[data-nbinlineai-subscription-action="use"]')).toBeEnabled();
  await setup.locator('[data-nbinlineai-subscription-action="use"]').click();
  await expect(panel.locator('[data-nbinlineai-notebook-provider]')).toHaveValue('openai_codex_subscription');
  await expect(panel.locator('[data-nbinlineai-notebook-model-select]')).toHaveValue('gpt-6-luna');
  await expect(page.locator('.lm-TabBar-tab.jp-mod-dirty')).toHaveCount(1);
  await page.getByRole('button', { name: 'Done' }).click();
  await page.keyboard.press('Meta+s');
  await expect(page.getByText('Saving completed')).toBeVisible();
  const saved = await request.get(`/api/contents/${name}?content=1`);
  const savedNotebook = (await saved.json()).content;
  expect(savedNotebook.metadata.nbinlineai.defaults).toMatchObject({
    backend: 'openai_codex_subscription', model: 'gpt-6-luna', reasoningEffort: 'low'
  });

  await page.getByRole('button', { name: 'Configure AI' }).first().click();
  await expect(setup).toBeVisible();
  fake.setState('expired');
  await setup.locator('[data-nbinlineai-subscription-action="refresh"]').click();
  await expect(setup).toContainText('sign-in expired');
  await expect(panel.locator('[data-nbinlineai-notebook-provider]')).toHaveValue('openai_codex_subscription');
  await expect(panel.locator('.jp-Cell.nbinlineai-prompt-cell [data-nbinlineai-run]')).toBeDisabled();
  fake.setState('connected');
  await setup.locator('[data-nbinlineai-subscription-action="refresh"]').click();
  await setup.locator('[data-nbinlineai-subscription-action="disconnect"]').click();
  await expect(setup).toContainText('does not sign you out of other apps or projects');
  expect(fake.disconnectCount).toBe(1);
  await expect(panel.locator('[data-nbinlineai-notebook-provider]')).toHaveValue('openai_codex_subscription');
});
