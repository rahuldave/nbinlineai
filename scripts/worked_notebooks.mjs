// One visible browser/context for trusted, opt-in worked notebook plans.
// No account details, token, provider response, or media bytes are logged.
import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir, chmod, realpath } from 'node:fs/promises';
import { resolve, join, dirname, isAbsolute } from 'node:path';
import { spawn } from 'node:child_process';
import { frames, observedTrace, sensitiveHardwareValues, normalizePublicCopy,
  addTraceAppendix, assertSafeNotebook, liveCellIndex, boundKernelSession,
  verifiedCodeWidgetSource, requiresSubscription, rejectLimitedSubscription } from './worked_notebooks_support.mjs';
import { readLiveReceipt, waitForReceiptStates } from './worked_receipt_ready.mjs';
import { assertOwnedPromptRequest, noToolPlan, acceptedNativeImage } from './worked_native_attestation.mjs';

const baseURL = 'http://127.0.0.1:8897';
const root = resolve(import.meta.dirname, '..');
const token = process.env.NBINLINEAI_WORKED_TOKEN;
const manifestPath = process.env.NBINLINEAI_WORKED_MANIFEST;
const outputDir = process.env.NBINLINEAI_WORKED_OUTPUT;
const ownedPython = process.env.NBINLINEAI_WORKED_PYTHON;
const sourceDir = process.env.NBINLINEAI_WORKED_SOURCE_DIR ?? join(root, 'examples');
const nativeObserverFile = process.env.NBINLINEAI_WORKED_NATIVE_IMAGE_OBSERVER_FILE;
if (!token || !manifestPath || !outputDir || !ownedPython) {
  throw new Error('Worked runner environment is incomplete');
}
if (!isAbsolute(sourceDir)) throw new Error('Worked source directory must be absolute');

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

async function nativeObserverRows() {
  if (!nativeObserverFile ||
      await realpath(dirname(resolve(nativeObserverFile))) !== await realpath(outputDir)) {
    throw new Error('Owned native image observer is unavailable');
  }
  const lines = (await readFile(nativeObserverFile, 'utf8')).trim().split('\n').filter(Boolean);
  if (lines.length > 64 || lines.some(line => line.length > 512)) {
    throw new Error('Owned native image observer exceeded its bound');
  }
  return lines.map(line => JSON.parse(line));
}
const receiptScript = join(root, 'scripts', 'worked_receipt_state.py');
const inspectReceipt = (kernelId, variable) => readLiveReceipt(ownedPython, receiptScript, kernelId, variable);
async function directProbe(kernelId, action, names = []) {
  return new Promise((resolveProbe, rejectProbe) => {
    const child = spawn(ownedPython, [join(root, 'scripts', 'worked_direct_probe.py'),
      kernelId, action, ...(action === 'arm' ? [JSON.stringify(names)] : [])],
    { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', () => { /* never print kernel connection details */ });
    child.once('error', rejectProbe);
    child.once('exit', code => {
      if (code !== 0 || stdout.length > 10_000) return rejectProbe(new Error('Direct-call probe failed'));
      try { resolveProbe(action === 'take' ? JSON.parse(stdout) : stdout.trim()); }
      catch { rejectProbe(new Error('Direct-call probe returned invalid data')); }
    });
  });
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
    imageModel: preferredImage?.id ?? imageModels[0]?.id ?? null,
    state: status.state, configured: status.configured === true, authMode: status.auth_mode };
}

async function ensureAccount(page, request) {
  let choice = await chooseSubscription(request);
  if (choice.connected && choice.model) {
    console.log(`Managed ChatGPT connection is ready; model ${choice.model}; image input ${choice.imageModel ? 'available' : 'unconfirmed'}.`);
    return choice;
  }
  rejectLimitedSubscription(choice);
  console.log(`Managed ChatGPT connection needs visible sign-in (state ${choice.state ?? 'unavailable'}, ` +
    `configured ${choice.configured}, auth mode ${choice.authMode ?? 'unavailable'}); waiting in Configure AI.`);
  if (!(await page.getByRole('button', { name: 'Configure AI' }).first().isVisible())) {
    throw new Error('Configure AI is unavailable on the current owned JupyterLab page');
  }
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
  const path = join(sourceDir, name);
  const source = JSON.parse(await readFile(path, 'utf8'));
  const coverage = JSON.parse(await readFile(join(root, 'examples', 'tool-coverage.json'), 'utf8'));
  const receiptVariables = new Map();
  const directNames = new Map();
  for (const entry of Object.values(coverage)) {
    if (entry.normal_example?.notebook !== name || !entry.receipt_inspect_cell || !entry.receipt_variable) continue;
    const values = receiptVariables.get(entry.receipt_inspect_cell) ?? new Set();
    values.add(entry.receipt_variable);
    receiptVariables.set(entry.receipt_inspect_cell, values);
  }
  for (const [toolName, entry] of Object.entries(coverage)) {
    if (entry.normal_example?.notebook !== name || entry.normal_example.mode !== 'python' ||
        ['insert_tools', 'tool_catalog', 'tools_markdown'].includes(toolName)) continue;
    const values = directNames.get(entry.normal_example.cell_id) ?? new Set();
    values.add(toolName);
    directNames.set(entry.normal_example.cell_id, values);
  }
  if (requiresSubscription(entry)) {
    const model = entry.requiresImage ? choice?.imageModel : choice?.model;
    if (!model) throw new Error(`${name} has no compatible discovered ChatGPT model`);
    const previous = source.metadata?.nbinlineai ?? {};
    source.metadata = { ...(source.metadata ?? {}), nbinlineai: {
      ...previous, defaults: { ...(previous.defaults ?? {}), backend: 'openai_codex_subscription',
        model, reasoningEffort: 'default', promptMode: previous.defaults?.promptMode ?? 'compact',
        keepAnswers: true }, defaultsInitialized: true } };
  }
  const codeIds = source.cells.filter(cell => cell.cell_type === 'code').map(cell => cell.id);
  const questionIds = source.cells.filter(cell => cell.cell_type === 'markdown' &&
    cell.metadata?.nbinlineai?.isPromptCell === true).map(cell => cell.id);
  const xsrf = (await context.cookies(baseURL)).find(cookie => cookie.name === '_xsrf')?.value;
  if (!xsrf) throw new Error(`${name} has no isolated Jupyter XSRF cookie`);
  const uploaded = await request.put(`/api/contents/${encodeURIComponent(name)}`, {
    headers: { 'X-XSRFToken': xsrf },
    data: { type: 'notebook', format: 'json', content: source } });
  if (!uploaded.ok()) throw new Error(`${name} could not be copied into the isolated project`);
  // Start the owned kernel before opening Lab. Some valid source notebooks have
  // no kernelspec; waiting for a UI kernel chooser would otherwise deadlock.
  const session = await request.post('/api/sessions', {
    headers: { 'X-XSRFToken': xsrf },
    data: { name, path: name, type: 'notebook', kernel: { name: 'python3' } },
  });
  if (!session.ok()) throw new Error(`${name} could not start its isolated kernel`);
  const createdSession = await session.json();
  await page.goto(`/lab/tree/${encodeURIComponent(name)}`);
  const panel = page.locator('.jp-NotebookPanel:visible');
  await until(async () => await panel.locator('.jp-Notebook').count() === 1, 60_000, `${name} notebook open`);
  let kernelId;
  await until(async () => {
    const response = await request.get('/api/sessions');
    if (!response.ok()) return false;
    kernelId = boundKernelSession(createdSession, await response.json(), name);
    return !!kernelId;
  }, 60_000, `${name} kernel`);
  const kernelDialog = page.getByRole('dialog').filter({ hasText: 'Select Kernel' });
  if (await kernelDialog.isVisible().catch(() => false)) {
    throw new Error(`${name} unexpectedly requested kernel selection after isolated startup`);
  }
  const traces = [];
  const receiptsByCell = new Map();
  const directByCell = new Map();
  const noToolByQuestion = new Map();
  const nativeImageByQuestion = new Map();
  const privateHardwareValues = new Set();
  const liveCell = async (id, kind) => {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id) ||
        !(kind === 'code' ? codeIds : questionIds).includes(id)) {
      throw new Error(`${name} has no safe ${kind} cell ${id}`);
    }
    // JupyterLab does not expose stable cell IDs as DOM attributes. Save the
    // owned disposable document and map its current model order to widgets;
    // AI insertions can shift every later code and question widget.
    const savedResponse = page.waitForResponse(item =>
      item.request().method() === 'PUT' &&
      new URL(item.url()).pathname.endsWith(`/api/contents/${encodeURIComponent(name)}`),
    { timeout: 5000 });
    void savedResponse.catch(() => {});
    await page.keyboard.press('Meta+S');
    const save = await savedResponse;
    if (!save.ok()) throw new Error(`${name} current cell model did not save`);
    const response = await request.get(`/api/contents/${encodeURIComponent(name)}?content=1`);
    if (!response.ok()) throw new Error(`${name} current cell model could not be read`);
    const cells = (await response.json()).content.cells;
    const sessions = await request.get('/api/sessions');
    if (!sessions.ok() || boundKernelSession(createdSession, await sessions.json(), name) !== kernelId) {
      throw new Error(`${name} no longer has its original kernel session`);
    }
    const index = liveCellIndex(cells, id, kind);
    // JupyterLab only materializes a window of large notebooks. Its rendered
    // cells carry their actual model index; a DOM ordinal is not a model index.
    const target = panel.locator(`.jp-Notebook .jp-Cell[data-windowed-list-index="${index}"]`);
    const outer = panel.locator('.jp-WindowedPanel-outer');
    for (let attempt = 0; attempt < cells.length && !(await target.count()); attempt++) {
      const shown = await panel.locator('.jp-Notebook .jp-Cell[data-windowed-list-index]')
        .evaluateAll(nodes => nodes.map(node => Number(node.getAttribute('data-windowed-list-index')))
          .filter(Number.isInteger));
      if (!shown.length) throw new Error(`${name} has no indexed rendered cells`);
      const direction = index < Math.min(...shown) ? -1 : 1;
      await outer.evaluate((node, sign) => { node.scrollTop += sign * Math.max(300, node.clientHeight * 0.8); }, direction);
      await pause(80);
    }
    if (await target.count() !== 1) throw new Error(`${name} model cell ${id} is not materialized at index ${index}`);
    const className = kind === 'code' ? 'jp-CodeCell' : 'nbinlineai-prompt-cell';
    if (!(await target.evaluate((node, expected) => node.classList.contains(expected), className))) {
      throw new Error(`${name} current cell ${id} has wrong widget type`);
    }
    if (kind === 'code') {
      await target.scrollIntoViewIfNeeded();
      const editorText = await target.locator('.cm-content').evaluate(node =>
        Array.from(node.querySelectorAll(':scope > .cm-line'), line => line.textContent ?? '').join('\n'));
      verifiedCodeWidgetSource(cells[index], editorText);
    }
    return target;
  };
  for (const step of entry.steps ?? []) {
    const timeout = Math.min(Math.max(Number(step.timeoutMs) || 30_000, 1000), 300_000);
    console.log(`${name}: ${step.action} ${step.cellId ?? 'control'}`);
    if (step.action === 'receipt-ready') {
      // Each probe runs in its own kernel turn, after the browser operation's
      // original call has returned. Do not wait on a comm in the call's turn.
      await waitForReceiptStates({ name, variables: step.variables, expectedStatus: step.status ?? 'completed',
        timeoutMs: timeout, read: (variable, remaining) => readLiveReceipt(ownedPython, receiptScript,
          kernelId, variable, { timeoutMs: remaining, allowUnregistered: true }) });
    } else if (step.action === 'code' || step.action === 'inspect') {
      const target = await liveCell(step.cellId, 'code');
      const watched = step.action === 'code' ? [...(directNames.get(step.cellId) ?? [])] : [];
      let probeAttempted = false;
      let executionError = null;
      let executionSucceeded = false;
      let text = '';
      try {
        if (watched.length) {
          probeAttempted = true;
          await directProbe(kernelId, 'arm', watched);
        }
        const inspectionDeadline = Date.now() + timeout;
        for (let attempt = 0; ; attempt++) {
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
          if (step.action !== 'inspect' || Date.now() >= inspectionDeadline) break;
          await pause(350);
        }
        if (step.contains && !text.includes(step.contains)) throw new Error(`${name} ${step.cellId} did not show expected result`);
        if (await target.locator('.jp-OutputArea .jp-RenderedText[data-mime-type="application/vnd.jupyter.stderr"]').count()) {
          throw new Error(`${name} ${step.cellId} produced stderr`);
        }
        executionSucceeded = true;
        if (step.action === 'inspect' && receiptVariables.has(step.cellId)) {
          const verified = [];
          for (const variable of receiptVariables.get(step.cellId)) {
            const receipt = await inspectReceipt(kernelId, variable);
            verified.push({ variable, operationId: receipt.operationId, status: receipt.status });
          }
          receiptsByCell.set(step.cellId, verified);
        }
      } catch (error) {
        executionError = error;
        throw error;
      } finally {
        if (probeAttempted) {
          try {
            const observed = await directProbe(kernelId, 'take');
            directByCell.set(step.cellId, observed.map(item => ({
              name: item.name, cellId: step.cellId, completed: executionSucceeded && item.completed,
            })));
          } catch (probeError) {
            if (!executionError) throw probeError;
          }
        }
      }
    } else if (step.action === 'ai') {
      const target = await liveCell(step.cellId, 'question');
      const observerBefore = step.nativeImageSha256 ? await nativeObserverRows() : null;
      const runButton = target.locator('[data-nbinlineai-run]');
      if (!(await runButton.isEnabled())) {
        throw new Error(`${name} ${step.cellId} is not runnable in the isolated notebook`);
      }
      const response = page.waitForResponse(item => item.url().endsWith('/nbinlineai/prompt') &&
        item.request().method() === 'POST', { timeout: Math.max(timeout, 180_000) })
        .then(async item => ({ requestBody: item.request().postDataJSON(), body: await item.text() }));
      // Keep a rejection handler attached if a UI click fails before the
      // response is awaited, so a later timeout cannot crash the whole run.
      void response.catch(() => {});
      await runButton.click();
      const completed = await response;
      const requestBody = completed.requestBody;
      assertOwnedPromptRequest(requestBody, step.cellId, createdSession.id);
      const events = frames(completed.body);
      for (const event of events) {
        if (event.type === 'tool_result') {
          for (const value of sensitiveHardwareValues(event.text ?? '')) privateHardwareValues.add(value);
        }
      }
      if (events.some(event => event.type === 'error') || !events.some(event => event.type === 'done')) {
        throw new Error(`${name} ${step.cellId} did not finish its live ChatGPT round`);
      }
      if (step.attestNoTool === true) {
        noToolByQuestion.set(step.cellId, noToolPlan(events, step.cellId));
      }
      if (observerBefore) {
        const observerAfter = await nativeObserverRows();
        nativeImageByQuestion.set(step.cellId, acceptedNativeImage(observerBefore, observerAfter,
          step.cellId, step.nativeImageSha256));
      }
      const observed = observedTrace(step.cellId, events);
      traces.push(...observed);
      const expectedTools = step.tools ?? (step.tool ? [step.tool] : []);
      for (const expected of expectedTools) {
        if (!observed.some(item => item.name === expected && ['completed', 'receipt accepted'].includes(item.resultState))) {
          throw new Error(`${name} ${step.cellId} did not return an accepted result for expected tool ${expected}`);
        }
      }
      await until(async () => /Done|Answer kept/.test(await target.locator('.nbinlineai-status').textContent() ?? ''),
        timeout, `${name} ${step.cellId} answer`);
    } else if (step.action === 'click') {
      await page.locator(step.selector).click({ timeout });
    } else if (step.action === 'dismiss-notification') {
      const close = page.getByTitle('Hide notification').first();
      if (await close.isVisible()) await close.click({ timeout });
    } else if (step.action === 'wait') {
      await until(async () => (await page.locator(step.selector).textContent() ?? '').includes(step.contains),
        timeout, `${name} visible control`);
    } else if (step.action === 'pause') {
      await pause(Math.min(Math.max(Number(step.milliseconds) || 0, 0), 60_000));
    } else if (step.action === 'play-test-tone') {
      if (typeof step.path !== 'string' || !/^\/tmp\/nbinlineai-worked-tone-[A-Za-z0-9-]+\.wav$/.test(step.path)) {
        throw new Error('Test tone must be an owned temporary WAV file');
      }
      await new Promise((resolveTone, rejectTone) => {
        const player = spawn('/usr/bin/afplay', ['-v', '0.3', step.path], { stdio: 'ignore' });
        player.once('error', rejectTone);
        player.once('exit', code => code === 0 ? resolveTone() : rejectTone(new Error('Owned test tone did not play')));
      });
    } else {
      throw new Error(`${name} has an unsupported plan action`);
    }
  }
  await page.keyboard.press('Meta+S');
  await pause(1200);
  const saved = await request.get(`/api/contents/${encodeURIComponent(name)}?content=1`);
  if (!saved.ok()) throw new Error(`${name} did not save through Jupyter Contents`);
  const notebook = (await saved.json()).content;
  for (const [cellId, receipts] of receiptsByCell) {
    const cell = notebook.cells.find(item => item.id === cellId);
    if (!cell) throw new Error(`${name} lost inspected receipt cell ${cellId}`);
    cell.metadata ??= {};
    cell.metadata.nbinlineaiWorkedReceipts = receipts;
  }
  for (const [cellId, calls] of directByCell) {
    const cell = notebook.cells.find(item => item.id === cellId);
    if (!cell) throw new Error(`${name} lost directly executed cell ${cellId}`);
    cell.metadata ??= {};
    cell.metadata.nbinlineaiWorkedDirectCalls = calls;
  }
  for (const [questionId, attestation] of noToolByQuestion) {
    const answers = notebook.cells.filter(item => item.metadata?.nbinlineai?.promptCellId === questionId &&
      item.metadata?.nbinlineai?.isOutputCell === true && item.metadata?.nbinlineai?.status === 'done');
    if (answers.length !== 1) throw new Error(`${name} lost the completed answer for ${questionId}`);
    answers[0].metadata.nbinlineaiWorkedNoToolPlan = attestation;
  }
  for (const [questionId, proof] of nativeImageByQuestion) {
    const answers = notebook.cells.filter(item => item.metadata?.nbinlineai?.promptCellId === questionId &&
      item.metadata?.nbinlineai?.isOutputCell === true && item.metadata?.nbinlineai?.status === 'done');
    if (answers.length !== 1) throw new Error(`${name} lost the native-image answer for ${questionId}`);
    answers[0].metadata.nbinlineaiWorkedNativeImage = proof;
  }
  addTraceAppendix(notebook, traces);
  normalizePublicCopy(notebook, privateHardwareValues);
  assertSafeNotebook(notebook);
  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  await chmod(outputDir, 0o700);
  const outputPath = join(outputDir, safeName(entry.output ?? name));
  await writeFile(outputPath, JSON.stringify(notebook, null, 1) + '\n', { mode: 0o600 });
  await chmod(outputPath, 0o600);
  console.log(`${name}: saved with ${traces.length} observed live notebook-tool calls.`);
}

// The installed Chrome app may already have macOS camera consent whereas the
// Playwright test app has a distinct macOS identity. Both use a fresh context.
const browserChannel = process.env.WORKED_BROWSER_CHANNEL;
if (browserChannel && browserChannel !== 'chrome') {
  throw new Error('WORKED_BROWSER_CHANNEL only supports the installed Chrome app');
}
const browser = await chromium.launch({ headless: false,
  ...(browserChannel ? { channel: browserChannel } : {}) });
try {
  // Use real hardware and grant the authorized localhost notebook origin only.
  // No fake-device flags or browser-wide permission pregrant are used.
  const context = await browser.newContext({ baseURL, viewport: { width: 1500, height: 1050 } });
  await context.grantPermissions(['camera', 'microphone'], { origin: baseURL });
  const page = await context.newPage();
  // Jupyter establishes its normal authenticated browser cookie from this one
  // local URL. The token is never printed or stored in a notebook artifact.
  await page.goto(`${baseURL}/lab?token=${encodeURIComponent(token)}`);
  const request = context.request;
  let choice = null;
  const finished = new Set();
  const failed = new Map();
  while (true) {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    for (const entry of manifest.notebooks ?? []) {
      const key = safeName(entry.output ?? entry.source);
      const revision = JSON.stringify(entry);
      if (finished.has(key) || failed.get(key) === revision) continue;
      try {
        if (requiresSubscription(entry) && !choice) {
          choice = await ensureAccount(page, request);
        }
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
