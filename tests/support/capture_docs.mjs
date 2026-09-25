/** Capture illustrative screenshots against the isolated deterministic E2E server. */
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, expect, request } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const base = 'http://127.0.0.1:8897';
const out = join(root, 'docs/images');
mkdirSync(out, { recursive: true });
let server;
let browser;
let api;

async function waitForServer() {
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw new Error('Isolated JupyterLab exited during startup');
    try { if ((await fetch(`${base}/lab`)).ok) return; } catch { /* starting */ }
    await delay(500);
  }
  throw new Error('Isolated JupyterLab did not become ready');
}

async function notebook(page, name, cells) {
  const created = await api.put(`/api/contents/${encodeURIComponent(name)}`, {
    headers: { 'X-XSRFToken': xsrf },
    data: { type: 'notebook', format: 'json', content: {
      cells: cells.map((cell, i) => ({ id: `student-${i}`, metadata: {}, ...cell,
        ...(cell.cell_type === 'code' ? { outputs: [], execution_count: null } : {}) })),
      metadata: { kernelspec: { display_name: 'Python 3 (ipykernel)', language: 'python', name: 'python3' } },
      nbformat: 4, nbformat_minor: 5
    } }
  });
  if (!created.ok()) throw new Error(`Could not create demo notebook: ${created.status()}`);
  await page.goto(`${base}/lab/workspaces/${name.replace(/\W/g, '-')}/tree/${encodeURIComponent(name)}`);
  const panel = page.locator('.jp-NotebookPanel:visible');
  await expect(panel.locator('.jp-Notebook .jp-Cell')).toHaveCount(cells.length);
  await expect.poll(async () => {
    const response = await api.get('/api/sessions');
    if (!response.ok()) return false;
    return (await response.json()).some(session => session.path === name && session.kernel?.id);
  }).toBeTruthy();
  return panel;
}

async function insert(page, afterIndex, source) {
  const cells = page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-Cell');
  await cells.nth(afterIndex).click();
  await page.getByRole('button', { name: 'AI Prompt' }).click();
  const prompt = page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-Cell.nbinlineai-prompt-cell').last();
  await expect(prompt).toBeVisible();
  await prompt.locator('.cm-content').fill(source);
  return prompt;
}

async function run(page, prompt) {
  await prompt.locator('[data-nbinlineai-run]').click();
  await expect(prompt.locator('.nbinlineai-status')).toContainText(/Answer kept|Done/);
  return page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-Cell.nbinlineai-response-cell').last();
}

async function checkContext(page, panel, prompt) {
  await prompt.click();
  const details = panel.locator('[data-nbinlineai-context-details]');
  if (await details.getAttribute('open') === null) await details.locator('summary').click();
  const status = details.locator('[data-nbinlineai-context-status]');
  const check = details.locator('[data-nbinlineai-context-refresh]');
  await expect(check).toBeEnabled();
  await check.click();
  await expect(status).toContainText('Context checked:');
  await details.locator('summary').click();
  await expect(details).not.toHaveAttribute('open', '');
}

async function capture(page, filename, locators) {
  await locators[0].scrollIntoViewIfNeeded();
  const boxes = [];
  for (const locator of locators) {
    await expect(locator).toBeVisible();
    const box = await locator.boundingBox();
    if (box) boxes.push(box);
  }
  const viewport = page.viewportSize();
  let x = Math.max(0, Math.min(...boxes.map(box => box.x)) - 20);
  const topPadding = ['overview.png', 'cell-overrides.png'].includes(filename) ? 50
    : ['keep-answer.png', 'prompt-starters.png', 'insert-code.png'].includes(filename) ? 0 : 20;
  let y = Math.max(0, Math.min(...boxes.map(box => box.y)) - topPadding);
  let right = Math.min(viewport.width, Math.max(...boxes.map(box => box.x + box.width)) + 20);
  let bottom = Math.min(viewport.height, Math.max(...boxes.map(box => box.y + box.height)) + 8);
  if (right - x < 600) right = Math.min(viewport.width, x + 600);
  await page.screenshot({ path: join(out, filename), clip: { x, y, width: right - x, height: bottom - y } });
}

let xsrf;
try {
  try {
    const existing = await fetch(`${base}/lab`);
    if (existing.ok) throw new Error('Port 8897 is already in use; refusing to attach to another server');
  } catch (error) {
    if (error.message?.includes('already in use')) throw error;
  }
  const log = createWriteStream('/tmp/nbinlineai-docs-server.log');
  server = spawn(join(root, '.venv/bin/python'), ['tests/support/e2e_server.py'], {
    cwd: root, env: { ...process.env, NBINLINEAI_E2E_PORT: '8897', NBINLINEAI_DOCS_CAPTURE: '1' }, stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout.pipe(log); server.stderr.pipe(log);
  await waitForServer();
  api = await request.newContext({ baseURL: base });
  await api.get('/lab');
  xsrf = (await api.storageState()).cookies.find(cookie => cookie.name === '_xsrf')?.value;
  if (!xsrf) throw new Error('No isolated XSRF cookie');
  for (const backend of ['openai_api', 'anthropic_api']) {
    const saved = await api.post('/nbinlineai/settings/keys', {
      headers: { 'X-XSRFToken': xsrf }, data: { backend, key: `docs-no-network-${backend}` }
    });
    if (!saved.ok()) throw new Error(`Could not set fake ${backend} key`);
  }
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1500, height: 1800 }, deviceScaleFactor: 1.5 });
  const page = await context.newPage();

  // Core notebook and the two small screenshots used in the public README.
  let panel = await notebook(page, 'Class scores.ipynb', [
    { cell_type: 'markdown', source: '## Explore class quiz scores\nThree practice scores: 6, 8, and 10.' },
    { cell_type: 'code', source: 'scores = [6, 8, 10]\naverage = sum(scores) / len(scores)\nprint(average)' }
  ]);
  if ((await page.evaluate(() => document.body.dataset.jpThemeName)) !== 'JupyterLab Light') {
    await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
    await page.locator('.lm-Menu-itemLabel', { hasText: /^Theme$/ }).hover();
    await page.locator('.lm-Menu-itemLabel', { hasText: /^JupyterLab Light$/ }).click();
    await expect.poll(() => page.evaluate(() => document.body.dataset.jpThemeName)).toBe('JupyterLab Light');
  }
  let prompt = await insert(page, 1, 'What does this average tell us?');
  let answer = await run(page, prompt);
  await checkContext(page, panel, prompt);
  await capture(page, 'overview.png', [panel.locator('[data-nbinlineai-notebook-defaults]'), panel.locator('.jp-Notebook .jp-Cell').first(), prompt, answer]);
  await capture(page, 'keep-answer.png', [panel.locator('[data-nbinlineai-notebook-defaults]'), prompt, answer]);
  await page.getByRole('button', { name: 'Configure AI' }).first().click();
  let dialog = page.locator('[data-nbinlineai-keys-dialog]');
  await dialog.locator('[data-nbinlineai-template-details] > summary').click();
  await dialog.locator('[data-nbinlineai-template-mode="learning"] > summary').click();
  await dialog.locator('[data-nbinlineai-template-details]').screenshot({ path: join(out, 'style-instructions.png') });
  await page.getByRole('button', { name: 'Done' }).click();
  await prompt.locator('[data-nbinlineai-override]').click();
  await prompt.locator('[data-nbinlineai-provider]').selectOption('anthropic_api');
  await prompt.locator('[data-nbinlineai-model-select]').selectOption('claude-sonnet-5');
  await prompt.locator('[data-nbinlineai-prompt-mode]').selectOption('full');
  await prompt.locator('[data-nbinlineai-effort]').selectOption('high');
  await prompt.locator('[data-nbinlineai-keep-answer]').uncheck();
  await prompt.locator('[data-nbinlineai-keep-answer]').check();
  await expect(prompt.locator('[data-nbinlineai-keep-inherit]')).toBeVisible();
  await checkContext(page, panel, prompt);
  await capture(page, 'cell-overrides.png', [panel.locator('[data-nbinlineai-notebook-defaults]'), prompt]);
  await prompt.locator('[data-nbinlineai-provider]').selectOption('');
  await prompt.locator('[data-nbinlineai-model-select]').selectOption('gpt-6-luna');
  await prompt.locator('[data-nbinlineai-effort]').selectOption('high');
  await expect(prompt.locator('[data-nbinlineai-provider]')).toHaveValue('');
  await capture(page, 'cell-inherits-provider.png', [panel.locator('[data-nbinlineai-notebook-defaults]'), prompt]);

  // Two short Socratic turns, both visible in a single notebook.
  panel = await notebook(page, 'Learning together.ipynb', [
    { cell_type: 'markdown', source: '## Work through the mean together\nUse questions and small hints before a solution.' },
    { cell_type: 'code', source: 'scores = [6, 8, 10]' }
  ]);
  await panel.locator('[data-nbinlineai-notebook-prompt-mode]').selectOption('learning');
  await insert(page, 1, 'How should I begin checking the average?');
  const first = page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-Cell.nbinlineai-prompt-cell').first();
  await run(page, first);
  const firstAnswer = page.locator('.jp-NotebookPanel:visible .jp-Notebook .jp-Cell.nbinlineai-response-cell').first();
  const second = await insert(page, 3, 'I found the total. What comes next?');
  const secondAnswer = await run(page, second);
  await first.scrollIntoViewIfNeeded();
  await capture(page, 'learning-dialog.png', [first, firstAnswer, second, secondAnswer]);

  // Rendered code with the copy action hovering over the fenced block.
  panel = await notebook(page, 'Check the average.ipynb', [
    { cell_type: 'markdown', source: '## Verify the calculation in Python' },
    { cell_type: 'code', source: 'scores = [6, 8, 10]' }
  ]);
  prompt = await insert(page, 1, 'Show a short Python example for checking the average.');
  answer = await run(page, prompt);
  await expect(answer.locator('[data-nbinlineai-copy-code]')).toHaveCount(1);
  await answer.locator('pre').hover();
  await capture(page, 'copy-code.png', [prompt, answer]);

  // Execute the ordinary Python setup, then use a live variable and an allowed function.
  panel = await notebook(page, 'Use live Python.ipynb', [
    { cell_type: 'markdown', source: '## Use the running Python kernel' },
    { cell_type: 'code', source: 'score = 10\ndef add_bonus(value: int):\n    global score\n    score += value\n    return score' },
    { cell_type: 'code', source: 'print(score)' }
  ]);
  const definition = panel.locator('.jp-Notebook .jp-CodeCell').first();
  await definition.click(); await page.keyboard.press('Shift+Enter');
  await expect(definition.locator('.jp-InputPrompt')).toContainText('1');
  prompt = await insert(page, 1, 'The current score is $`score`. Use add_bonus to update the score by calling &`add_bonus` once with 4, then explain the result.');
  answer = await run(page, prompt);
  const check = panel.locator('.jp-Notebook .jp-CodeCell').nth(1);
  await check.click(); await page.keyboard.press('Shift+Enter');
  await expect(check.locator('.jp-OutputArea')).toContainText('14');
  await capture(page, 'variables-tools.png', [definition, prompt, answer, check]);

  // Notes and code above the prompt are context; the later note remains below it.
  panel = await notebook(page, 'Notebook context.ipynb', [
    { cell_type: 'markdown', source: '## Project notes\nThe quiz scores are 6, 8, and 10. Compare the mean with each score.\n\n&`study_helper`' },
    { cell_type: 'code', source: 'scores = [6, 8, 10]\naverage = sum(scores) / len(scores)\ndef study_helper(value: int):\n    return value' },
    { cell_type: 'markdown', source: '## Later exercise\nTry a different set of scores after this question.' }
  ]);
  const contextSetup = panel.locator('.jp-Notebook .jp-CodeCell').first();
  await contextSetup.click(); await page.keyboard.press('Shift+Enter');
  await expect(contextSetup.locator('.jp-InputPrompt')).toContainText('1');
  prompt = await insert(page, 1, 'What does this average tell us?');
  answer = await run(page, prompt);
  await checkContext(page, panel, prompt);
  await capture(page, 'context.png', [panel.locator('.jp-Notebook .jp-Cell').first(), prompt, answer, panel.locator('.jp-Notebook .jp-Cell').last()]);

  // Show independent text and tool choices with source on both sides of the question.
  await prompt.click();
  await panel.locator('[data-nbinlineai-context-mode]').selectOption('ten-above-below');
  await expect(panel.locator('[data-nbinlineai-context-target]')).toContainText(/^Context for AI question 3$/);
  const firstContext = panel.locator('.jp-Notebook .jp-Cell').first().locator('[data-nbinlineai-context-include]');
  await expect(firstContext).toBeChecked();
  await firstContext.uncheck();
  await expect(panel.locator('[data-nbinlineai-context-mode]')).toHaveValue('custom');
  await expect(panel.locator('[data-nbinlineai-context-status]')).toContainText(/\d+ included|Context checked:/);
  await expect(panel.locator('.jp-Notebook .jp-Cell').first().locator('[data-nbinlineai-tools-include]')).toBeChecked();
  await expect(panel.locator('.jp-Notebook .jp-Cell').last().locator('[data-nbinlineai-context-include]')).toBeChecked();
  await capture(page, 'context-selection.png', [
    panel.locator('[data-nbinlineai-notebook-defaults]'),
    panel.locator('.jp-Notebook .jp-Cell').first(),
    prompt,
    panel.locator('.jp-Notebook .jp-Cell').last()
  ]);
  await panel.locator('[data-nbinlineai-context-details] > summary').click();
  await expect(panel.locator('[data-nbinlineai-context-refresh]')).toBeVisible();
  await panel.locator('[data-nbinlineai-context-refresh]').click();
  await expect(panel.locator('[data-nbinlineai-context-status]')).toContainText(/Context checked:/);
  await expect(panel.locator('[data-nbinlineai-context-report]')).toContainText('First-round estimate');
  await panel.locator('.nbinlineai-context-row').screenshot({ path: join(out, 'context-details.png') });

  panel = await notebook(page, 'Start with an AI question.ipynb', [
    { cell_type: 'markdown', source: '## Practice with class scores\nTry one of the suggested questions.' },
    { cell_type: 'code', source: 'scores = [6, 8, 10]' }
  ]);
  prompt = await insert(page, 1, '');
  await expect(prompt.locator('[data-nbinlineai-starters] button')).toHaveCount(4);
  await capture(page, 'prompt-starters.png', [panel.locator('.jp-Notebook .jp-Cell').nth(1), prompt]);

  panel = await notebook(page, 'Review an AI code suggestion.ipynb', [
    { cell_type: 'code', source: 'scores = [6, 8, 10]' },
    { cell_type: 'markdown', source: 'Suggest a short Python cell that computes the mean score.',
      metadata: { nbinlineai: { isPromptCell: true, keepAnswer: true } } },
    { cell_type: 'markdown', source: 'I added a code cell below. Review it, then run it when you are ready.',
      metadata: { nbinlineai: { isOutputCell: true, promptCellId: 'student-1', status: 'done' } } },
    { cell_type: 'code', source: 'mean_score = sum(scores) / len(scores)\nprint(f"Class mean: {mean_score:.1f}")' }
  ]);
  await expect(panel.locator('.nbinlineai-response-cell')).toHaveCount(1);
  await expect(panel.locator('.jp-CodeCell').last().locator('.jp-OutputArea-output')).toHaveCount(0);
  await capture(page, 'insert-code.png', [panel.locator('.nbinlineai-prompt-cell'),
    panel.locator('.nbinlineai-response-cell'), panel.locator('.jp-CodeCell').last()]);

  console.log('Captured thirteen illustrative JupyterLab screenshots in docs/images/');
} finally {
  await api?.dispose();
  await browser?.close();
  if (server && server.exitCode === null) {
    server.kill('SIGINT');
    await Promise.race([new Promise(resolve => server.once('exit', resolve)), delay(5000)]);
    if (server.exitCode === null) server.kill('SIGKILL');
  }
}
