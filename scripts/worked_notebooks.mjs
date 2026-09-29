// One visible browser/context for trusted, opt-in worked notebook plans.
// No account details, token, provider response, or media bytes are logged.
import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, resolve, join } from 'node:path';

const baseURL = 'http://127.0.0.1:8897';
const root = resolve(import.meta.dirname, '..');
const token = process.env.NBINLINEAI_WORKED_TOKEN;
const manifestPath = process.env.NBINLINEAI_WORKED_MANIFEST;
const outputDir = process.env.NBINLINEAI_WORKED_OUTPUT;
if (!token || !manifestPath || !outputDir) throw new Error('Worked runner environment is incomplete');

const pause = ms => new Promise(resolvePause => setTimeout(resolvePause, ms));
async function until(check, timeout, description) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await pause(350);
  }
  throw new Error(`${description} timed out`);
}
function safeName(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]*\.ipynb$/.test(value) || value.includes('..')) {
    throw new Error('Notebook name must be a flat .ipynb filename');
  }
  return value;
}
function sourceText(cell) {
  return Array.isArray(cell.source) ? cell.source.join('') : String(cell.source ?? '');
}
function redact(value) {
  let text = typeof value === 'string' ? value : JSON.stringify(value);
  text = text.replace(/(?:Bearer\s+|token[=:]\s*)[^\s"']+/ig, '[redacted]')
    .replace(/(?:\/Users\/|\/home\/|\/tmp\/)[^\s"']+/g, '[local path]')
    .replace(/[A-Za-z0-9+/_-]{200,}={0,2}/g, '[large or opaque value]');
  return text.slice(0, 700);
}
function frames(body) {
  return body.split('\n\n').flatMap(frame => {
    const line = frame.split('\n').find(item => item.startsWith('data: '));
    if (!line) return [];
    try { return [JSON.parse(line.slice(6))]; } catch { return []; }
  });
}
function observedTrace(questionId, events) {
  const starts = events.filter(event => event.type === 'tool_start');
  const results = events.filter(event => event.type === 'tool_result');
  const actions = events.filter(event => event.type === 'frontend_action');
  return starts.map(start => ({ questionId, name: start.name,
    arguments: redact(start.arguments),
    result: redact(results.find(result => result.id === start.id)?.text ?? '[no result event]'),
    frontendAction: actions.some(action => action.id === start.id) }));
}
function addTraceAppendix(notebook, traces) {
  if (!traces.length) return;
  const rows = traces.map(item => `| ${item.questionId} | \`${item.name}\` | ${item.arguments.replaceAll('|', '\\|')} | ${item.result.replaceAll('|', '\\|')} |`);
  notebook.cells.push({ cell_type: 'markdown', id: 'worked-observed-tool-trace',
    metadata: { nbinlineaiWorkedTrace: true },
    source: ['## Observed notebook-tool calls\n',
      'This appendix was recorded from actual subscription prompt events. Long or private fields are redacted.\n\n',
      '| Question cell | Tool | Submitted arguments | Observed result |\n',
      '| --- | --- | --- | --- |\n', ...rows.map(row => `${row}\n`)] });
}
function assertSafeNotebook(notebook) {
  const encoded = JSON.stringify(notebook);
  for (const pattern of [/(?:Bearer\s+|sk-[A-Za-z0-9_-]{20,})/i,
    /(?:\/Users\/|\/home\/rahul\/|\/tmp\/nbinlineai-worked-)/,
    /(?:device_code|verification_url|auth_url)["']?\s*:/i]) {
    if (pattern.test(encoded)) throw new Error('Saved notebook contains a sensitive field or local path');
  }
  if (encoded.length > 30_000_000) throw new Error('Saved notebook exceeds the worked-output size limit');
}

async function chooseSubscription(request) {
  const response = await request.get('/nbinlineai/subscription/status');
  if (!response.ok()) throw new Error('Subscription status is unavailable in the owned server');
  const status = await response.json();
  const models = Array.isArray(status.models) ? status.models : [];
  const connected = status.state === 'connected' && status.configured === true && status.auth_mode === 'chatgpt';
  const imageModels = models.filter(item => item.input_modalities?.includes('image'));
  const preferred = models.find(item => item.id === 'gpt-6-sol');
  const preferredImage = imageModels.find(item => item.id === 'gpt-6-sol');
  return { connected, model: preferred?.id ?? models[0]?.id ?? null,
    imageModel: preferredImage?.id ?? imageModels[0]?.id ?? null };
}

async function ensureAccount(page, request) {
  let choice = await chooseSubscription(request);
  if (choice.connected && choice.model) {
    console.log(`Managed ChatGPT connection is ready; model ${choice.model}; image input ${choice.imageModel ? 'available' : 'unconfirmed'}.`);
    return choice;
  }
  console.log('Managed ChatGPT connection needs visible sign-in; waiting in Configure AI.');
  await page.getByRole('button', { name: 'Configure AI' }).first().click();
  const dialog = page.locator('[data-nbinlineai-keys-dialog]');
  await dialog.locator('[data-nbinlineai-connection]').selectOption('openai_codex_subscription');
  const setup = dialog.locator('[data-nbinlineai-subscription-setup]');
  await until(() => setup.isVisible(), 20_000, 'Subscription setup');
  await setup.locator('[data-nbinlineai-subscription-action="device-login"]').click();
  console.log('Use the device sign-in instructions visible in the browser; waiting up to 30 minutes.');
  await until(async () => {
    choice = await chooseSubscription(request);
    return choice.connected && !!choice.model;
  }, 1_800_000, 'Managed ChatGPT sign-in');
  await page.getByRole('button', { name: 'Done' }).click();
  console.log(`Managed ChatGPT connected; model ${choice.model}; image input ${choice.imageModel ? 'available' : 'unconfirmed'}.`);
  return choice;
}

async function runNotebook(page, request, context, entry, choice) {
  const name = safeName(entry.source);
  const path = join(root, 'examples', name);
  const source = JSON.parse(await readFile(path, 'utf8'));
  const model = entry.requiresImage ? choice.imageModel : choice.model;
  if (!model) throw new Error(`${name} has no compatible discovered ChatGPT model`);
  const previous = source.metadata?.nbinlineai ?? {};
  source.metadata = { ...(source.metadata ?? {}), nbinlineai: {
    ...previous, defaults: { ...(previous.defaults ?? {}), backend: 'openai_codex_subscription',
      model, reasoningEffort: 'default', promptMode: previous.defaults?.promptMode ?? 'compact',
      keepAnswers: true }, defaultsInitialized: true } };
  const codeIds = source.cells.filter(cell => cell.cell_type === 'code').map(cell => cell.id);
  const questionIds = source.cells.filter(cell => cell.cell_type === 'markdown' &&
    cell.metadata?.nbinlineai?.isPromptCell === true).map(cell => cell.id);
  const xsrf = (await context.cookies(baseURL)).find(cookie => cookie.name === '_xsrf')?.value;
  if (!xsrf) throw new Error(`${name} has no isolated Jupyter XSRF cookie`);
  const uploaded = await request.put(`/api/contents/${encodeURIComponent(name)}`, {
    headers: { 'X-XSRFToken': xsrf },
    data: { type: 'notebook', format: 'json', content: source } });
  if (!uploaded.ok()) throw new Error(`${name} could not be copied into the isolated project`);
  await page.goto(`/lab/tree/${encodeURIComponent(name)}`);
  const panel = page.locator('.jp-NotebookPanel:visible');
  await until(async () => await panel.locator('.jp-Notebook').count() === 1, 60_000, `${name} notebook open`);
  await until(async () => {
    const response = await request.get('/api/sessions');
    return response.ok() && (await response.json()).some(session => session.path === name && session.kernel?.id);
  }, 60_000, `${name} kernel`);
  const select = page.getByRole('button', { name: 'Select', exact: true });
  if (await select.isVisible().catch(() => false)) await select.click();
  const no = page.getByRole('button', { name: 'No', exact: true });
  if (await no.isVisible().catch(() => false)) await no.click();
  const traces = [];
  const code = id => {
    const index = codeIds.indexOf(id);
    if (index < 0) throw new Error(`${name} has no code cell ${id}`);
    return panel.locator('.jp-CodeCell').nth(index);
  };
  const question = id => {
    const index = questionIds.indexOf(id);
    if (index < 0) throw new Error(`${name} has no AI question ${id}`);
    return panel.locator('.nbinlineai-prompt-cell').nth(index);
  };
  for (const step of entry.steps ?? []) {
    const timeout = Math.min(Math.max(Number(step.timeoutMs) || 30_000, 1000), 300_000);
    if (step.action === 'code' || step.action === 'inspect') {
      const target = code(step.cellId);
      let text = '';
      for (let attempt = 0; attempt < (step.action === 'inspect' ? 12 : 1); attempt++) {
        const prompt = target.locator('.jp-InputPrompt');
        const before = await prompt.textContent();
        await target.locator('.cm-content').click();
        await page.keyboard.press('Control+Enter');
        await until(async () => {
          const now = await prompt.textContent();
          return now !== before && /\[\d+\]/.test(now ?? '');
        }, timeout, `${name} ${step.cellId} execution`);
        text = await target.locator('.jp-OutputArea').textContent() ?? '';
        if (!step.contains || text.includes(step.contains)) break;
        if (/\b(?:failed|expired|error)\b/i.test(text)) break;
        await pause(250);
      }
      if (step.contains && !text.includes(step.contains)) throw new Error(`${name} ${step.cellId} did not show expected result`);
      if (await target.locator('.jp-OutputArea .jp-RenderedText[data-mime-type="application/vnd.jupyter.stderr"]').count()) {
        throw new Error(`${name} ${step.cellId} produced stderr`);
      }
    } else if (step.action === 'ai') {
      const target = question(step.cellId);
      const response = page.waitForResponse(item => item.url().endsWith('/nbinlineai/prompt') &&
        item.request().method() === 'POST', { timeout: Math.max(timeout, 180_000) });
      await target.locator('[data-nbinlineai-run]').click();
      const completed = await response;
      const requestBody = completed.request().postDataJSON();
      if (requestBody.backend !== 'openai_codex_subscription' || requestBody.prompt_cell_id !== step.cellId) {
        throw new Error(`${name} ${step.cellId} used an unexpected model route`);
      }
      const events = frames(await completed.text());
      if (events.some(event => event.type === 'error') || !events.some(event => event.type === 'done')) {
        throw new Error(`${name} ${step.cellId} did not finish its live ChatGPT round`);
      }
      const observed = observedTrace(step.cellId, events);
      traces.push(...observed);
      if (step.tool && !observed.some(item => item.name === step.tool && item.result !== '[no result event]')) {
        throw new Error(`${name} ${step.cellId} did not execute expected tool ${step.tool}`);
      }
      await until(async () => /Done|Answer kept/.test(await target.locator('.nbinlineai-status').textContent() ?? ''),
        timeout, `${name} ${step.cellId} answer`);
    } else if (step.action === 'click') {
      await page.locator(step.selector).click({ timeout });
    } else if (step.action === 'wait') {
      await until(async () => (await page.locator(step.selector).textContent() ?? '').includes(step.contains),
        timeout, `${name} visible control`);
    } else if (step.action === 'pause') {
      await pause(Math.min(Math.max(Number(step.milliseconds) || 0, 0), 60_000));
    } else {
      throw new Error(`${name} has an unsupported plan action`);
    }
  }
  await page.keyboard.press('Meta+S');
  await pause(1200);
  const saved = await request.get(`/api/contents/${encodeURIComponent(name)}?content=1`);
  if (!saved.ok()) throw new Error(`${name} did not save through Jupyter Contents`);
  const notebook = (await saved.json()).content;
  addTraceAppendix(notebook, traces);
  assertSafeNotebook(notebook);
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, safeName(entry.output ?? name)), JSON.stringify(notebook, null, 1) + '\n');
  console.log(`${name}: saved with ${traces.length} observed live notebook-tool calls.`);
}

const browser = await chromium.launch({ headless: false });
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1500, height: 1050 } });
  const page = await context.newPage();
  // Jupyter establishes its normal authenticated browser cookie from this one
  // local URL. The token is never printed or stored in a notebook artifact.
  await page.goto(`${baseURL}/lab?token=${encodeURIComponent(token)}`);
  const request = context.request;
  const choice = await ensureAccount(page, request);
  const finished = new Set();
  const failed = new Map();
  while (true) {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    for (const entry of manifest.notebooks ?? []) {
      const key = safeName(entry.output ?? entry.source);
      const revision = JSON.stringify(entry);
      if (finished.has(key) || failed.get(key) === revision) continue;
      try {
        await runNotebook(page, request, context, entry, choice);
        finished.add(key);
        failed.delete(key);
      } catch (error) {
        failed.set(key, revision);
        console.error(`${key}: ${error instanceof Error ? error.message : 'execution failed'}; awaiting a revised plan.`);
        if (!manifest.continuous) throw error;
      }
    }
    if (!manifest.continuous || manifest.stop === true) break;
    await pause(2000);
  }
} catch (error) {
  console.error(`Worked notebook runner stopped: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
