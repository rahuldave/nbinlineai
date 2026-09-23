/** Offline coexistence smoke: `node tests/support/jupyter_ai_compat_smoke.mjs`.
 * Uses published packages in .venv/jupyter-ai-compat, never port 8888.
 */
import { chromium, request as playwrightRequest } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';

const repo = path.resolve(import.meta.dirname, '../..');
const origin = 'http://127.0.0.1:8898';
const available = port => new Promise(resolve => {
  const server = net.createServer();
  server.once('error', () => resolve(false));
  server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
});
const code = (id, source) => ({ cell_type: 'code', id, metadata: {}, execution_count: null, outputs: [], source });
const ai = (id, source) => ({ cell_type: 'markdown', id, metadata: { nbinlineai: { isPromptCell: true } }, source });
const answer = (id, promptCellId, source) => ({ cell_type: 'markdown', id, metadata: { nbinlineai: { isOutputCell: true, promptCellId, status: 'done' } }, source });
const waitForServer = async () => {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${origin}/lab`)).ok) return; } catch {}
    await delay(500);
  }
  throw new Error('Isolated JupyterLab did not start');
};

if (!(await available(8898)) || !(await available(3001))) {
  throw new Error('Ports 8898 or 3001 already in use; refusing to start compatibility smoke');
}
const python = path.join(repo, '.venv/jupyter-ai-compat/bin/python');
const server = spawn(python, ['-I', path.join(repo, 'tests/support/jupyter_ai_compat_smoke.py')], {
  cwd: repo,
  env: { ...process.env, PATH: `${path.join(repo, '.venv/jupyter-ai-compat/bin')}:/usr/bin:/bin` },
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', chunk => { serverLog += chunk.toString(); });
server.stderr.on('data', chunk => { serverLog += chunk.toString(); });
let browser;
try {
  await waitForServer();
  console.log("phase: server ready");
  const api = await playwrightRequest.newContext({ baseURL: origin });
  await api.get('/lab');
  const xsrf = (await api.storageState()).cookies.find(cookie => cookie.name === '_xsrf')?.value;
  assert(xsrf, 'missing XSRF cookie');
  const key = await api.post('/nbinlineai/settings/keys', {
    headers: { 'X-XSRFToken': xsrf },
    data: { backend: 'openai_api', key: 'compat-fake-never-sent' },
  });
  assert(key.ok(), `fake key setup failed: ${await key.text()}`);
  const name = 'compat-smoke.ipynb';
  const cells = [
    code('setup', 'counter = 0\ndef bump(value: int):\n    global counter\n    counter += value\n    return counter'),
    ai('question', 'COMPAT_BUMP call &`bump` once'),
    code('after', 'print("AFTER_AI", counter)'),
    ai('kept', 'This saved answer must be kept.'),
    answer('kept-answer', 'kept', 'PRESERVED_ANSWER'),
    code('single', 'single_cell_marker = globals().get("single_cell_marker", 0) + 1\nprint("SINGLE_CODE", single_cell_marker)'),
    ai('single-ai', 'Jupyter AI single-cell command should leave this alone.'),
    answer('single-ai-answer', 'single-ai', 'PRESERVED_SINGLE_AI_ANSWER'),
  ];
  const put = await api.put(`/api/contents/${name}`, {
    headers: { 'X-XSRFToken': xsrf },
    data: { type: 'notebook', format: 'json', content: {
      cells, metadata: { kernelspec: { display_name: 'Python 3 (compat smoke)', language: 'python', name: 'python3' },
        nbinlineai: { defaults: { backend: 'openai_api', model: 'gpt-6-sol', promptMode: 'compact', reasoningEffort: 'default', keepAnswers: true }, defaultsInitialized: true } },
      nbformat: 4, nbformat_minor: 5,
    } },
  });
  assert(put.ok(), `notebook creation failed: ${await put.text()}`);
  console.log("phase: fixture ready");
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ baseURL: origin });
  const promptPosts = [];
  page.on('request', req => { if (req.url().endsWith('/nbinlineai/prompt') && req.method() === 'POST') promptPosts.push(req.postData()); });
  await page.goto(`/lab/workspaces/compat-smoke/tree/${name}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  console.log("phase: lab loaded");
  await page.locator('.jp-NotebookPanel:visible .jp-Cell').first().waitFor({ timeout: 30000 });
  console.log("phase: notebook visible");
  const kernelDialog = page.getByRole('dialog').filter({ hasText: 'Select Kernel' });
  if (await kernelDialog.isVisible().catch(() => false)) {
    await kernelDialog.getByRole('button', { name: 'Select' }).click();
  }
  await page.waitForFunction(() => Boolean(window.jupyterapp?.commands), { timeout: 20000 });
  console.log("phase: commands exposed");
  const commands = await page.evaluate(() => ({
    aiCommand: window.jupyterapp.commands.hasCommand('jupyterlab-ai-commands:run-cell'),
    coreRunAll: window.jupyterapp.commands.hasCommand('notebook:run-all-cells'),
  }));
  assert(commands.aiCommand && commands.coreRunAll, `missing commands: ${JSON.stringify(commands)}`);
  await page.locator('.lm-MenuBar-item').filter({ hasText: /^Run$/ }).click();
  await page.getByRole('menuitem', { name: 'Run All Cells', exact: true }).click();
  try { await page.getByText('AFTER_AI 4').waitFor({ timeout: 25000 }); } catch (error) {
    console.error('notebook text:', (await page.locator('.jp-NotebookPanel:visible').innerText()).slice(-3000));
    console.error('prompt posts:', promptPosts.length, promptPosts.map(x => JSON.parse(x).prompt));
    throw error;
  }
  assert.equal(promptPosts.length, 1, 'Run All must call only the uncompleted AI prompt');
  assert(await page.getByText('PRESERVED_ANSWER').count(), 'kept answer disappeared');
  console.log('PASS native Run All: code→AI tool→later code ordered; completed answer kept; one fake provider request');

  // The released Jupyter AI command accepts a cell ID and routes code directly
  // to CodeCell.execute. Probe its registered command through the app test hook.
  const singleResult = await page.evaluate(() => window.jupyterapp.commands.execute('jupyterlab-ai-commands:run-cell', { cellId: 'single' }));
  await page.getByText('SINGLE_CODE 2').waitFor({ timeout: 30000 });
  assert.equal(singleResult?.status, 'ok');
  const beforeAi = promptPosts.length;
  const markdownResult = await page.evaluate(() => window.jupyterapp.commands.execute('jupyterlab-ai-commands:run-cell', { cellId: 'single-ai' }));
  await delay(750);
  assert.equal(markdownResult?.status, 'no-op');
  assert.equal(markdownResult?.cellId, 'single-ai');
  assert.equal(promptPosts.length, beforeAi, 'Jupyter AI single-cell command unexpectedly called the inline provider');
  console.log(`PASS Jupyter AI single-cell command: code executed, tagged Markdown did not call provider (returns ${JSON.stringify(singleResult)}, ${JSON.stringify(markdownResult)})`);

  // Source edits through the notebook model should leave our metadata intact.
  const tag = await page.evaluate(() => {
    const panel = window.jupyterapp.shell.currentWidget;
    const model = panel.content.model;
    const cell = [...model.cells].find(item => item.id === 'single-ai');
    cell.sharedModel.setSource('Edited tagged question.');
    return cell.getMetadata('nbinlineai');
  });
  assert(tag?.isPromptCell === true, 'editing source lost AI question metadata');
  console.log('PASS source edit preserves metadata.nbinlineai.isPromptCell');
  await api.dispose();
} catch (error) {
  console.error(serverLog.slice(-4000));
  throw error;
} finally {
  if (browser) await browser.close();
  try { process.kill(-server.pid, 'SIGTERM'); } catch {}
  await delay(1000);
  try { process.kill(-server.pid, 'SIGKILL'); } catch {}
}
