import { expect, test, type APIRequestContext, type Page } from '../support/e2e-fixtures';

test.skip(process.env.NBINLINEAI_E2E_SUBSCRIPTION !== '1',
  'Run with the isolated fake ChatGPT manager, never a real account');

type Cell = { id: string; cell_type: 'code' | 'markdown'; source: string; metadata: object;
  outputs?: object[]; execution_count?: null };
const code = (id: string, source: string): Cell => ({
  id, cell_type: 'code', source, metadata: {}, outputs: [], execution_count: null
});
const ai = (id: string, source: string): Cell => ({
  id, cell_type: 'markdown', source, metadata: { nbinlineai: { isPromptCell: true } }
});

async function putNotebook(request: APIRequestContext, name: string, cells: Cell[]) {
  await request.get('/lab');
  const xsrf = (await request.storageState()).cookies.find(cookie => cookie.name === '_xsrf')?.value;
  expect(xsrf).toBeTruthy();
  const response = await request.put(`/api/contents/${name}`, {
    headers: { 'X-XSRFToken': xsrf! },
    data: { type: 'notebook', format: 'json', content: {
      cells,
      metadata: {
        kernelspec: { display_name: 'Python 3 (ipykernel)', language: 'python', name: 'python3' },
        nbinlineai: { defaults: { backend: 'openai_codex_subscription', model: 'gpt-6-sol',
          reasoningEffort: 'medium', keepAnswers: true }, defaultsInitialized: true }
      },
      nbformat: 4, nbformat_minor: 5
    } }
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

async function openNotebook(page: Page, request: APIRequestContext, name: string, cells: Cell[]) {
  await putNotebook(request, name, cells);
  await page.goto(`/lab/workspaces/${name.replace(/[^a-z0-9]/gi, '-')}/tree/${name}`);
  const panel = page.locator('.jp-NotebookPanel:visible');
  await expect(panel.locator('.jp-Notebook .jp-Cell')).toHaveCount(cells.length);
  await expect.poll(async () => {
    const sessions = await request.get('/api/sessions');
    return sessions.ok() && (await sessions.json()).some((session: any) => session.path === name && session.kernel?.id);
  }).toBeTruthy();
  return panel;
}

async function runAll(page: Page) {
  await page.locator('.lm-MenuBar-item').filter({ hasText: /^Run$/ }).click();
  await page.getByRole('menuitem', { name: 'Run All Cells', exact: true }).click();
}

test('ChatGPT-only Run All executes declared notebook tools, context, and Keep through the real server', async ({ page, request }) => {
  const statusResponse = await request.get('/nbinlineai/status');
  const status = await statusResponse.json();
  expect(status.subscription_capable).toBe(true);
  expect(status.providers.openai_codex_subscription.configured).toBe(true);
  expect(status.providers.openai_api.configured).toBe(false);
  expect(status.providers.anthropic_api.configured).toBe(false);

  const panel = await openNotebook(page, request, `subscription-run-${Date.now()}.ipynb`, [
    code('setup', 'counter = 0\ndef bump(value: int):\n    global counter\n    counter += value\n    return counter'),
    ai('tool', 'E2E_TOOL call &`bump` once'),
    code('inspect', 'after_ai = counter\nprint("SUBSCRIPTION_AFTER_AI", after_ai)'),
    ai('later', 'E2E_BASIC inspect $`after_ai`'),
    code('finished', 'subscription_pass = globals().get("subscription_pass", 0) + 1\nprint("SUBSCRIPTION_PASS", subscription_pass)')
  ]);
  const posts: object[] = [];
  page.on('request', item => {
    if (item.url().endsWith('/nbinlineai/prompt') && item.method() === 'POST') posts.push(item.postDataJSON());
  });
  const prompt = panel.locator('.nbinlineai-prompt-cell').first();
  await prompt.locator('[data-nbinlineai-override]').click();
  await expect(prompt.locator('[data-nbinlineai-provider]')).toHaveValue('openai_codex_subscription');
  await expect(prompt.locator('[data-nbinlineai-provider]')).toBeEnabled();
  await expect(prompt.locator('[data-nbinlineai-run]')).toBeEnabled();
  await runAll(page);
  await expect(panel.locator('.jp-CodeCell').nth(1).locator('.jp-OutputArea')).toContainText('SUBSCRIPTION_AFTER_AI 4');
  await expect(panel.locator('.nbinlineai-prompt-cell').last().locator('.nbinlineai-status')).toContainText(/Done|Answer kept/);
  await expect(panel.locator('.nbinlineai-response-cell')).toHaveCount(2);
  await expect(panel.locator('.nbinlineai-response-cell').last()).toContainText('E2E provider=openai_codex_subscription');
  await expect(panel.locator('.nbinlineai-response-cell').last()).toContainText('E2E_BASIC inspect 4');
  await expect(panel.locator('.jp-CodeCell').last().locator('.jp-OutputArea')).toContainText('SUBSCRIPTION_PASS 1');
  expect(posts).toHaveLength(2);
  expect(posts.every((body: any) => body.backend === 'openai_codex_subscription')).toBe(true);

  await runAll(page);
  await expect(panel.locator('.jp-CodeCell').last().locator('.jp-OutputArea')).toContainText('SUBSCRIPTION_PASS 2');
  await expect(panel.locator('.nbinlineai-response-cell')).toHaveCount(2);
  expect(posts).toHaveLength(2);
});

test('same cell ID in two notebooks stays isolated when one ChatGPT run is cancelled', async ({ page, request }) => {
  const first = await openNotebook(page, request, `subscription-a-${Date.now()}.ipynb`, [
    code('code', 'FIRST_NOTEBOOK_ONLY = 1'), ai('ask', 'E2E_SLOW FIRST_NOTEBOOK_ONLY')
  ]);
  const other = await page.context().newPage();
  try {
    const second = await openNotebook(other, request, `subscription-b-${Date.now()}.ipynb`, [
      code('code', 'SECOND_NOTEBOOK_ONLY = 2'), ai('ask', 'E2E_BASIC SECOND_NOTEBOOK_ONLY')
    ]);
    const firstPrompt = first.locator('.nbinlineai-prompt-cell');
    const secondPrompt = second.locator('.nbinlineai-prompt-cell');
    await firstPrompt.locator('[data-nbinlineai-run]').click();
    await expect(firstPrompt.locator('[data-nbinlineai-cancel]')).toBeEnabled();
    await secondPrompt.locator('[data-nbinlineai-run]').click();
    await expect(secondPrompt.locator('.nbinlineai-status')).toContainText(/Done|Answer kept/);
    await expect(second.locator('.nbinlineai-response-cell')).toContainText('SECOND_NOTEBOOK_ONLY');
    await expect(second.locator('.nbinlineai-response-cell')).not.toContainText('FIRST_NOTEBOOK_ONLY');
    await firstPrompt.locator('[data-nbinlineai-cancel]').click();
    await expect(firstPrompt.locator('.nbinlineai-status')).toHaveText('Cancelled');
    await expect(second.locator('.nbinlineai-response-cell')).toContainText('E2E provider=openai_codex_subscription');
  } finally {
    await other.close();
  }
});
