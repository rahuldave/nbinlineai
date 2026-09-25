import { APIRequestContext, expect, test, Page } from '../support/e2e-fixtures';

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
  let documentationDemo = false;
  const status = () => ({
    state,
    configured: state === 'connected' || state === 'limited',
    account: state === 'connected' || state === 'limited'
      ? { display_name: documentationDemo ? 'Demo connection (simulated)' : 'Sample student',
          workspace: 'Class workspace' } : undefined,
    models: state === 'connected' || state === 'limited' ? offeredModels : [],
    usage: documentationDemo ? { state: 'unavailable' } : { state: 'available', remaining_percent: 60 },
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
    setDocumentationDemo(value: boolean) { documentationDemo = value; },
    setModels(value: typeof models) { offeredModels = value; },
    get loginMethod() { return loginMethod; },
    get loginCancelCount() { return loginCancelCount; },
    get disconnectCount() { return disconnectCount; }
  };
}

async function createNotebook(request: APIRequestContext, name: string, xsrf: string,
  defaults = { backend: 'openai_codex_subscription', model: 'gpt-6-sol' }) {
  const response = await request.put(`/api/contents/${name}`, {
    headers: { 'X-XSRFToken': xsrf },
    data: { type: 'notebook', format: 'json', content: {
      cells: [{ id: 'setup', cell_type: 'code', source: 'value = 1', metadata: {}, outputs: [], execution_count: null }],
      metadata: {
        kernelspec: { display_name: 'Python 3 (ipykernel)', language: 'python', name: 'python3' },
        nbinlineai: { defaults }
      },
      nbformat: 4, nbformat_minor: 5
    } }
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

test('a ChatGPT notebook choice reaches cells that inherit it while explicit Anthropic cells stay pinned', async ({ page, request }) => {
  const fake = await mockSubscription(page);
  fake.setState('connected');
  await request.get('/lab');
  const xsrf = (await request.storageState()).cookies.find(cookie => cookie.name === '_xsrf')?.value;
  expect(xsrf).toBeTruthy();
  const anthropic = await request.post('/nbinlineai/settings/keys', {
    headers: { 'X-XSRFToken': xsrf! }, data: { backend: 'anthropic_api', key: 'e2e-no-network-anthropic' }
  });
  expect(anthropic.ok(), await anthropic.text()).toBeTruthy();
  const name = `subscription-inherit-${Date.now()}.ipynb`;
  await createNotebook(request, name, xsrf!, { backend: 'anthropic_api', model: 'claude-sonnet-5' });
  await page.goto(`/lab/workspaces/${name.slice(0, -6)}/tree/${name}`);
  const panel = page.locator('.jp-NotebookPanel:visible');
  await panel.locator('.jp-CodeCell').first().click();
  await page.getByRole('button', { name: 'AI Prompt' }).click();
  const prompt = panel.locator('.nbinlineai-prompt-cell');
  await expect(prompt).toBeVisible();
  await prompt.locator('[data-nbinlineai-override]').click();
  const provider = prompt.locator('[data-nbinlineai-provider]');
  await expect(provider).toHaveValue('');
  await provider.selectOption('anthropic_api');

  await page.getByRole('button', { name: 'Configure AI' }).first().click();
  const dialog = page.locator('[data-nbinlineai-keys-dialog]');
  await dialog.locator('[data-nbinlineai-connection]').selectOption('openai_codex_subscription');
  const setup = dialog.locator('[data-nbinlineai-subscription-setup]');
  await expect(setup.locator('[data-nbinlineai-subscription-action="use"]')).toBeEnabled();
  await setup.locator('[data-nbinlineai-subscription-action="use"]').click();
  await expect(panel.locator('[data-nbinlineai-notebook-provider]')).toHaveValue('openai_codex_subscription');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(provider).toHaveValue('anthropic_api');
  await provider.selectOption('');
  await expect(provider).toHaveValue('');
  await expect(provider.locator('option').first()).toContainText('ChatGPT');
  await expect(prompt.locator('[data-nbinlineai-model-select] option').first()).toContainText('gpt-6-sol');
});

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
  // The kernel fills Jupyter's language_info after notebook startup. Save that
  // native metadata before measuring whether sign-in touches the notebook.
  await expect.poll(async () => {
    await page.keyboard.press('ControlOrMeta+s');
    const saved = await request.get(`/api/contents/${name}?content=1`);
    return saved.ok() ? (await saved.json()).content.metadata?.language_info?.name : null;
  }, { timeout: 30_000, intervals: [500, 1000, 1000] }).toBe('python');
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
  await expect(setup.locator('[data-nbinlineai-subscription-scope]')).toHaveCount(0);
  await expect(setup.locator('[data-nbinlineai-subscription-scope-static]')).toBeVisible();
  await expect(setup.locator('select')).toHaveCount(2);
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
  await page.keyboard.press('ControlOrMeta+s');
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

if (process.env.NBINLINEAI_CAPTURE_DOCS === '1') {
  test('capture the simulated connected ChatGPT setup for documentation', async ({ page, request }) => {
    await page.setViewportSize({ width: 1280, height: 1400 });
    const fake = await mockSubscription(page);
    fake.setState('connected');
    fake.setDocumentationDemo(true);
    await request.get('/lab');
    const xsrf = (await request.storageState()).cookies.find(cookie => cookie.name === '_xsrf')?.value;
    expect(xsrf).toBeTruthy();
    const name = `subscription-docs-${Date.now()}.ipynb`;
    await createNotebook(request, name, xsrf!);
    await page.goto(`/lab/workspaces/${name.slice(0, -6)}/tree/${name}`);
    const panel = page.locator('.jp-NotebookPanel:visible');
    await expect(panel.locator('.jp-CodeCell')).toHaveCount(1);
    await panel.locator('.jp-CodeCell').click();
    await page.getByRole('button', { name: 'AI Prompt' }).click();
    await expect(panel.locator('.nbinlineai-prompt-cell')).toBeVisible();
    await page.addStyleTag({ content: `
      .jp-Dialog-content, .jp-Dialog-body, .nbinlineai-keys-dialog {
        max-height: none !important; height: auto !important; overflow: visible !important;
      }
    ` });
    await page.getByRole('button', { name: 'Configure AI' }).first().click();
    const dialog = page.locator('[data-nbinlineai-keys-dialog]');
    const setup = dialog.locator('[data-nbinlineai-subscription-setup]');
    await expect(setup).toContainText('Demo connection (simulated)');
    await expect(setup).toContainText('Usage information is unavailable');
    await expect(setup.locator('[data-nbinlineai-subscription-action="use"]')).toBeEnabled();
    const defaultConnection = dialog.locator('[data-nbinlineai-default-backend]');
    await expect(defaultConnection).toBeEnabled();
    await defaultConnection.selectOption('openai_codex_subscription');
    await expect(dialog.locator('[data-nbinlineai-default-backend-notice]')).toContainText('default for new notebooks');
    await setup.locator('details').last().evaluate(element => { (element as HTMLDetailsElement).open = true; });
    await expect(setup.locator('[data-nbinlineai-subscription-scope]')).toHaveCount(0);
    await expect(setup.locator('[data-nbinlineai-subscription-scope-static]')).toBeVisible();
    await page.locator('.jp-Dialog-content').screenshot({ path: 'docs/images/configure-ai.png' });
  });
}
