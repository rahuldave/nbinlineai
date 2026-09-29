import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { visualPromptGate, visualSignalPaths, waitForVisualContinue,
  assertObservedSelection, closeVisualPromptPage } from '../scripts/worked_notebooks.mjs';

const question = 'outputs-ai-selection-nonempty';
const session = 'owned-session';
const bound = { backend: 'openai_codex_subscription', session_id: session,
  prompt_cell_id: question };
function route(body = bound, url = 'http://127.0.0.1:8897/nbinlineai/prompt') {
  const state = { continued: 0, aborted: 0 };
  return { state, request: () => ({ url: () => url, method: () => 'POST',
    postDataJSON: () => body }), async continue() { state.continued++; },
  async abort() { state.aborted++; } };
}

test('visual prompt gate stays active after the first response through the bound status request', async () => {
  const gate = visualPromptGate(question, session);
  const owned = route();
  await gate.handle(owned);
  assert.deepEqual(owned.state, { continued: 1, aborted: 0 });
  gate.assertStarted();
  assert.throws(() => gate.assertCompleted(), /start and status/);
  gate.armStatus();
  const status = route({ ...bound, prompt_cell_id: 'outputs-ai-selection-nonempty-ready' });
  await gate.handle(status);
  assert.deepEqual(status.state, { continued: 1, aborted: 0 });
  gate.assertCompleted();
  const extra = route({ ...bound, prompt_cell_id: 'outputs-ai-selection-nonempty-ready' });
  await gate.handle(extra);
  assert.deepEqual(extra.state, { continued: 0, aborted: 1 });
  await assert.rejects(gate.failure, /blocked before model submission/);
  assert.throws(() => gate.assertCompleted(), /start and status/);
});

test('visual prompt gate blocks wrong second request after the first response', async () => {
  for (const bad of [
    route(bound),
    route({ ...bound, session_id: 'other', prompt_cell_id: 'outputs-ai-selection-nonempty-ready' }),
    route({ ...bound, prompt_cell_id: 'other' }),
    route({ ...bound, prompt_cell_id: 'outputs-ai-selection-nonempty-ready' },
      'http://127.0.0.1:8897/nbinlineai/prompt?other=1'),
  ]) {
    const gate = visualPromptGate(question, session);
    await gate.handle(route());
    gate.assertStarted();
    if (bad.request().postDataJSON().prompt_cell_id !== question) gate.armStatus();
    await gate.handle(bad);
    assert.deepEqual(bad.state, { continued: 0, aborted: 1 });
    await assert.rejects(gate.failure, /blocked before model submission/);
    assert.throws(() => gate.assertCompleted(), /start and status/);
    const afterFailure = route({ ...bound, prompt_cell_id: 'outputs-ai-selection-nonempty-ready' });
    await gate.handle(afterFailure);
    assert.deepEqual(afterFailure.state, { continued: 0, aborted: 1 });
  }
});

test('second submission is blocked until the runner arms the exact status step', async () => {
  const gate = visualPromptGate(question, session);
  await gate.handle(route());
  gate.assertStarted();
  const early = route({ ...bound, prompt_cell_id: 'outputs-ai-selection-nonempty-ready' });
  await gate.handle(early);
  assert.deepEqual(early.state, { continued: 0, aborted: 1 });
  await assert.rejects(gate.failure, /blocked before model submission/);
  assert.throws(() => gate.armStatus(), /cannot be armed/);
});

test('visual prompt gate blocks wrong first session, question, and endpoint', async () => {
  for (const bad of [
    route({ ...bound, session_id: 'other' }),
    route({ ...bound, prompt_cell_id: 'other' }),
    route(bound, 'http://127.0.0.1:8897/nbinlineai/prompt?other=1'),
    route(bound, 'http://127.0.0.1:8897/nbinlineai/other'),
  ]) {
    const gate = visualPromptGate(question, session);
    await gate.handle(bad);
    assert.deepEqual(bad.state, { continued: 0, aborted: 1 });
    await assert.rejects(gate.failure, /blocked before model submission/);
    assert.throws(() => gate.assertCompleted(), /start and status/);
  }
});

test('visual route is removed only after closing its owned page, including a failing run', async () => {
  const events = [];
  await closeVisualPromptPage({ async close() { events.push('close'); } },
    { async unroute() { events.push('unroute'); } });
  assert.deepEqual(events, ['close', 'unroute']);
  await assert.rejects(closeVisualPromptPage({ async close() { throw new Error('close failed'); } },
    { async unroute() { events.push('unsafe unroute'); } }), /close failed/);
  assert.deepEqual(events, ['close', 'unroute']);
});

test('private nonce signal must exactly match this visual handoff', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'worked-visual-test-'));
  try {
    const paths = visualSignalPaths(directory, question);
    const expected = { nonce: 'new', notebook: 'browser-media-outputs.ipynb',
      questionCellId: question, selectionCellId: 'selection-ai-target',
      selectedText: 'selected blue square' };
    await assert.rejects(waitForVisualContinue(paths, expected, 130), /timed out/);
    await writeFile(paths.continue, JSON.stringify({ ...expected, nonce: 'stale' }));
    await assert.rejects(waitForVisualContinue(paths, expected, 130), /does not match/);
    await writeFile(paths.continue, JSON.stringify(expected));
    await waitForVisualContinue(paths, expected, 130);
    assert.deepEqual(JSON.parse(await readFile(paths.continue, 'utf8')), expected);
    assert.throws(() => visualSignalPaths('relative', question), /absolute private/);
    assert.throws(() => visualSignalPaths(directory, '../other'), /safe cell ID/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('selected-text proof requires the first receipt and its exact completed status', () => {
  const operationId = 'abcdefghijklmnopqrstuvwxyz123456';
  const expected = { cellId: 'selection-ai-target', text: 'selected blue square' };
  const first = [{ name: 'read_selection', resultState: 'receipt accepted', operationId }];
  const status = [{ name: 'operation_status', resultState: 'completed',
    targetOperationId: operationId, result: JSON.stringify({ operation_id: operationId,
      status: 'completed', result: { cell_id: expected.cellId, text: expected.text } }) }];
  assert.doesNotThrow(() => assertObservedSelection(status, first, expected));
  for (const bad of [
    [], [{ ...status[0], targetOperationId: 'other' }],
    [{ ...status[0], result: JSON.stringify({ status: 'running' }) }],
    [{ ...status[0], result: JSON.stringify({ status: 'completed', result: {
      cell_id: expected.cellId, text: '' } }) }],
    [{ ...status[0], result: JSON.stringify({ status: 'completed', result: {
      cell_id: 'selection-normal-target', text: expected.text } }) }],
  ]) assert.throws(() => assertObservedSelection(bad, first, expected), /exact nonempty/);
  assert.throws(() => assertObservedSelection(status, [], expected), /exact nonempty/);
});
