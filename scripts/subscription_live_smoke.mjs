// Interactive browser half of subscription_live_smoke.py. No account details or
// provider responses are printed; all notebook content is synthetic and bounded.
import { chromium } from '@playwright/test';

const baseURL = 'http://127.0.0.1:8897';
const fail = code => { throw new Error(code); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function until(check, timeoutMs, code) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await pause(500);
  }
  fail(code);
}

function frames(responseText) {
  return responseText.split('\n\n').flatMap(frame => {
    const line = frame.split('\n').find(item => item.startsWith('data: '));
    if (!line) return [];
    try { return [JSON.parse(line.slice(6))]; } catch { fail('invalid-sse-frame'); }
  });
}

function code(id, source) {
  return { id, cell_type: 'code', source, metadata: {}, outputs: [], execution_count: null };
}

function question(id, source) {
  return { id, cell_type: 'markdown', source,
    metadata: { nbinlineai: { isPromptCell: true } } };
}

async function notebook(request, context) {
  await request.get('/lab');
  const xsrf = (await context.cookies(baseURL)).find(cookie => cookie.name === '_xsrf')?.value;
  if (!xsrf) fail('missing-isolated-xsrf');
  const name = 'subscription-live-acceptance.ipynb';
  const cells = [
    code('setup', 'from nbinlineai.tools import read_cell\nsmoke_counter = 0\ndef add_one(n: int) -> int:\n    global smoke_counter\n    smoke_counter += 1\n    return n + smoke_counter'),
    question('tool-question', 'Call &`add_one` exactly once with n=3, then report its returned integer. Do not guess it.'),
    code('verify', 'print("SMOKE_COUNTER", smoke_counter)'),
    question('read-question', 'Call &`read_cell` for cell_id="live-source", start_line=1, end_line=1. Report the exact unsaved source line returned by the tool.'),
    code('live-source', 'SAVED_MARKER = 1'),
    question('cancel-question', 'Write a careful six-paragraph explanation of why saved notebook files can differ from live unsaved cells.')
  ];
  const created = await request.put(`/api/contents/${name}`, {
    headers: { 'X-XSRFToken': xsrf },
    data: { type: 'notebook', format: 'json', content: {
      cells,
      metadata: {
        kernelspec: { display_name: 'Python 3 (ipykernel)', language: 'python', name: 'python3' },
        nbinlineai: { defaults: { backend: 'openai_codex_subscription', model: 'gpt-6-sol',
          keepAnswers: true }, defaultsInitialized: true }
      }, nbformat: 4, nbformat_minor: 5
    } }
  });
  if (!created.ok()) fail('synthetic-notebook-creation-failed');
  return name;
}

let phase = 'browser-start';
const browser = await chromium.launch({ headless: false });
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1500, height: 1050 } });
  const page = await context.newPage();
  const request = context.request;
  const name = await notebook(request, context);
  phase = 'notebook-open';
  await page.goto(`/lab/workspaces/subscription-live-acceptance/tree/${name}`);
  const panel = page.locator('.jp-NotebookPanel:visible');
  await until(async () => await panel.locator('.jp-Notebook .jp-Cell').count() === 6,
    60_000, 'synthetic-notebook-did-not-open');
  await until(async () => {
    const response = await request.get('/api/sessions');
    if (!response.ok()) return false;
    return (await response.json()).some(session => session.path === name && session.kernel?.id);
  }, 60_000, 'synthetic-kernel-did-not-start');

  phase = 'interactive-sign-in';
  const before = await request.get('/nbinlineai/subscription/status');
  if (!before.ok() || (await before.json()).state !== 'signed_out') fail('managed-store-was-not-fresh');
  await page.getByRole('button', { name: 'Configure AI' }).first().click();
  const dialog = page.locator('[data-nbinlineai-keys-dialog]');
  await dialog.locator('[data-nbinlineai-connection]').selectOption('openai_codex_subscription');
  const setup = dialog.locator('[data-nbinlineai-subscription-setup]');
  await until(() => setup.isVisible(), 20_000, 'subscription-setup-not-visible');
  const popup = page.waitForEvent('popup', { timeout: 20_000 });
  await setup.locator('[data-nbinlineai-subscription-action="login"]').click();
  await popup;
  console.log('Complete ChatGPT sign-in in the opened browser. Waiting up to ten minutes.');
  let connected = null;
  await until(async () => {
    const response = await request.get('/nbinlineai/subscription/status');
    if (!response.ok()) return false;
    const status = await response.json();
    if (status.state === 'connected' && status.configured && status.auth_mode === 'chatgpt' &&
        status.models?.length) {
      connected = status;
      return true;
    }
    return false;
  }, 600_000, 'chatgpt-sign-in-did-not-complete');
  await setup.locator('[data-nbinlineai-subscription-action="refresh"]').click();
  await setup.locator('[data-nbinlineai-subscription-model]').selectOption(connected.models[0].id);
  await until(() => setup.locator('[data-nbinlineai-subscription-action="use"]').isEnabled(),
    15_000, 'subscription-model-could-not-be-selected');
  await setup.locator('[data-nbinlineai-subscription-action="use"]').click();
  await page.getByRole('button', { name: 'Done' }).click();

  // Fail closed if the browser tries to send an API backend or exceeds three
  // synthetic questions. One validated notebook-tool group is enough per run.
  let promptRequests = 0;
  await page.route('**/nbinlineai/prompt', async route => {
    promptRequests += 1;
    let body;
    try { body = route.request().postDataJSON(); } catch { return route.abort(); }
    if (promptRequests > 3 || body.backend !== 'openai_codex_subscription') return route.abort();
    body.max_tool_steps = Math.min(Number(body.max_tool_steps) || 0, 1);
    await route.continue({ postData: JSON.stringify(body) });
  });

  phase = 'kernel-tool';
  const codes = panel.locator('.jp-CodeCell');
  await codes.first().click();
  await page.keyboard.press('Shift+Enter');
  await until(async () => (await codes.first().locator('.jp-InputPrompt').textContent())?.includes('[1]'),
    30_000, 'setup-code-did-not-execute');
  const prompts = panel.locator('.nbinlineai-prompt-cell');
  const firstResponse = page.waitForResponse(response => response.url().endsWith('/nbinlineai/prompt') &&
    response.request().method() === 'POST', { timeout: 180_000 });
  await prompts.first().locator('[data-nbinlineai-run]').click();
  const firstEvents = frames(await (await firstResponse).text());
  if (!firstEvents.some(event => event.type === 'tool_start' && event.name === 'add_one') ||
      !firstEvents.some(event => event.type === 'done' && event.tool_steps === 1)) {
    fail('model-did-not-complete-one-kernel-tool-group');
  }
  await codes.nth(1).click();
  await page.keyboard.press('Shift+Enter');
  await until(async () => (await codes.nth(1).locator('.jp-OutputArea').textContent())?.includes('SMOKE_COUNTER 1'),
    30_000, 'kernel-tool-effect-was-not-exactly-once');

  phase = 'unsaved-live-read';
  await codes.nth(2).locator('.cm-content').fill('UNSAVED_LIVE_MARKER = 74');
  const saved = await request.get(`/api/contents/${name}?content=1`);
  if (!saved.ok() || !(await saved.text()).includes('SAVED_MARKER = 1')) fail('saved-live-distinction-lost');
  const readResponse = page.waitForResponse(response => response.url().endsWith('/nbinlineai/prompt') &&
    response.request().method() === 'POST', { timeout: 180_000 });
  await prompts.nth(1).locator('[data-nbinlineai-run]').click();
  const readEvents = frames(await (await readResponse).text());
  if (!readEvents.some(event => event.type === 'frontend_action' && event.name === 'read_cell') ||
      !readEvents.some(event => event.type === 'tool_result' &&
        String(event.text).includes('UNSAVED_LIVE_MARKER = 74'))) {
    fail('model-did-not-read-unsaved-live-cell');
  }

  phase = 'keep-no-replay';
  const beforeKeep = promptRequests;
  // A protected completed answer disables Run; native Shift+Enter is the
  // meaningful Keep path exercised by ordinary notebook execution.
  await prompts.first().click();
  await page.keyboard.press('Shift+Enter');
  await pause(1200);
  if (promptRequests !== beforeKeep) fail('keep-replayed-completed-question');
  if (!(await codes.nth(1).locator('.jp-OutputArea').textContent()).includes('SMOKE_COUNTER 1')) {
    fail('completed-kernel-effect-changed');
  }

  phase = 'cancel-run';
  await prompts.nth(2).locator('[data-nbinlineai-run]').click();
  const cancel = prompts.nth(2).locator('[data-nbinlineai-cancel]');
  await until(() => cancel.isEnabled(), 15_000, 'cancel-control-not-enabled');
  await cancel.click();
  await until(async () => (await prompts.nth(2).locator('.nbinlineai-status').textContent())?.includes('Cancelled'),
    30_000, 'running-question-was-not-cancelled');
  if (promptRequests !== 3) fail('unexpected-subscription-request-count');
  console.log('Synthetic notebook tool, unsaved live read, Keep, cancellation, and request bounds passed.');
} catch {
  console.error(`Subscription acceptance failed at ${phase}. No account details were printed.`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
