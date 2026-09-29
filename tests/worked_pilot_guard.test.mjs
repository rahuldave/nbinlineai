import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pilotQuestion, preparePilotSettings, assertPilotPromptRequest,
  pilotRouteGuard, installPilotRouteGuard } from '../scripts/worked_notebooks.mjs';

const owned = { backend: 'openai_codex_subscription', session_id: 'session-1',
  prompt_cell_id: 'question-1', max_tool_steps: 1 };
const request = (body = owned, url = 'http://127.0.0.1:8897/nbinlineai/prompt', method = 'POST') => ({
  url: () => url, method: () => method, postDataJSON: () => body,
});
function route(body = owned) {
  const state = { continued: 0, aborted: 0 };
  return { state, request: () => request(body),
    async continue() { state.continued += 1; },
    async abort() { state.aborted += 1; } };
}

test('pilot plan admits exactly one named AI question with literal step limit one', () => {
  const plan = { pilotMaxToolSteps: 1, notebooks: [{ source: 'lesson.ipynb',
    steps: [{ action: 'code', cellId: 'setup' }, { action: 'ai', cellId: 'question-1' }] }] };
  assert.deepEqual(pilotQuestion(plan), { notebook: 'lesson.ipynb', cellId: 'question-1' });
  assert.deepEqual(pilotQuestion({ ...plan, continuous: false }),
    { notebook: 'lesson.ipynb', cellId: 'question-1' });
  assert.equal(pilotQuestion({ notebooks: plan.notebooks }), null);
  for (const changed of [
    { ...plan, pilotMaxToolSteps: 5 },
    { ...plan, continuous: true },
    { ...plan, continuous: 1 },
    { ...plan, continuous: 'yes' },
    { ...plan, notebooks: [...plan.notebooks, ...plan.notebooks] },
    { ...plan, notebooks: [{ ...plan.notebooks[0], steps: [
      ...plan.notebooks[0].steps, { action: 'ai', cellId: 'question-2' }] }] },
  ]) assert.throws(() => pilotQuestion(changed), /Pilot requires/);
});

test('pilot setting is confined to a new isolated config file', async () => {
  const config = await mkdtemp(join(tmpdir(), 'worked-pilot-test-'));
  try {
    const path = await preparePilotSettings(config);
    assert.equal(path, join(config, 'lab/user-settings/nbinlineai/plugin.jupyterlab-settings'));
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { maxToolSteps: 1 });
    await assert.rejects(() => preparePilotSettings(config), /EEXIST/);
    await assert.rejects(() => preparePilotSettings('relative-config'), /isolated absolute/);
  } finally {
    await rm(config, { recursive: true, force: true });
  }
});

test('prompt request must match owned POST, binding, and literal max_tool_steps one', () => {
  assert.doesNotThrow(() => assertPilotPromptRequest(request(), 'question-1', 'session-1'));
  for (const body of [
    { ...owned, max_tool_steps: 5 }, { backend: owned.backend, session_id: owned.session_id,
      prompt_cell_id: owned.prompt_cell_id }, { ...owned, session_id: 'other' },
    { ...owned, prompt_cell_id: 'other' }, { ...owned, backend: 'openai_api' },
  ]) assert.throws(() => assertPilotPromptRequest(request(body), 'question-1', 'session-1'));
  for (const mismatch of [
    request(owned, 'http://localhost:8897/nbinlineai/prompt'),
    request(owned, 'http://127.0.0.1:8897/nbinlineai/prompt?retry=1'),
    request(owned, 'http://127.0.0.1:8897/nbinlineai/prompt/'),
    request(owned, 'http://127.0.0.1:8897/nbinlineai/prompt', 'GET'),
  ]) assert.throws(() => assertPilotPromptRequest(mismatch, 'question-1', 'session-1'));
});

test('route guard forwards one valid prompt and aborts a duplicate', async () => {
  const guard = pilotRouteGuard('question-1');
  guard.bind('session-1');
  const first = route();
  await guard.handle(first);
  assert.deepEqual(first.state, { continued: 1, aborted: 0 });
  guard.assertCompleted();
  const duplicate = route();
  await guard.handle(duplicate);
  assert.deepEqual(duplicate.state, { continued: 0, aborted: 1 });
  await assert.rejects(guard.failure, /blocked before model submission/);
  assert.throws(() => guard.assertCompleted(), /exactly one/);
});

test('context route guards prompt requests from another page in the same context', async () => {
  for (const secondBody of [owned, { ...owned, session_id: 'other' }]) {
    const guard = pilotRouteGuard('question-1');
    let routeHandler;
    const context = { async route(pattern, handler) {
      assert.equal(pattern, '**/nbinlineai/prompt**');
      routeHandler = handler;
    } };
    await installPilotRouteGuard(context, guard);
    guard.bind('session-1');
    const firstPage = route();
    await routeHandler(firstPage);
    assert.deepEqual(firstPage.state, { continued: 1, aborted: 0 });
    const secondPage = route(secondBody);
    await routeHandler(secondPage);
    assert.deepEqual(secondPage.state, { continued: 0, aborted: 1 });
    await assert.rejects(guard.failure, /blocked before model submission/);
  }
});

test('route guard aborts unbound and mismatched requests before forwarding', async () => {
  for (const [bind, body] of [
    [false, owned], [true, { ...owned, max_tool_steps: 5 }],
    [true, { ...owned, max_tool_steps: undefined }],
    [true, { ...owned, session_id: 'stale' }],
    [true, { ...owned, prompt_cell_id: 'other' }],
    [true, { ...owned, backend: 'openai_api' }],
  ]) {
    const guard = pilotRouteGuard('question-1');
    if (bind) guard.bind('session-1');
    const invalid = route(body);
    await guard.handle(invalid);
    assert.deepEqual(invalid.state, { continued: 0, aborted: 1 });
    await assert.rejects(guard.failure, /blocked before model submission/);
    assert.throws(() => guard.assertCompleted(), /exactly one/);
  }
});
