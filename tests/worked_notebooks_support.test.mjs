import test from 'node:test';
import assert from 'node:assert/strict';
import { observedTrace, normalizePublicCopy, addTraceAppendix, assertSafeNotebook,
  sensitiveHardwareValues, toolResultState } from '../scripts/worked_notebooks_support.mjs';

test('tool events distinguish action correlation, error, and accepted receipt', () => {
  const calls = observedTrace('question', [
    { type: 'tool_start', id: 'a', name: 'insert_code', arguments: { code: 'x = 1' } },
    { type: 'frontend_action', run_id: 'run', request_id: 'request', name: 'insert_code' },
    { type: 'tool_result', id: 'a', name: 'insert_code', text: 'Inserted one code cell.' },
    { type: 'tool_start', id: 'b', name: 'save_media', arguments: {} },
    { type: 'tool_result', id: 'b', name: 'save_media', text: '{"status":"accepted"}' },
    { type: 'tool_start', id: 'c', name: 'inspect_python', arguments: {} },
    { type: 'tool_result', id: 'c', name: 'inspect_python', text: 'Error: missing name' },
  ]);
  assert.deepEqual(calls.map(call => [call.frontendAction, call.resultState]),
    [[true, 'completed'], [false, 'receipt accepted'], [false, 'failed']]);
  assert.equal(toolResultState('{"status":"failed","error":"not ready"}'), 'failed');
  assert.equal(toolResultState('{"code":"permission_denied","message":"Camera access denied"}'), 'failed');
  assert.equal(toolResultState('{"code":"unsupported","message":"No renderer"}'), 'failed');
  assert.equal(toolResultState('{"code":"needs_secure_context","message":"Use localhost"}'), 'failed');
  for (const status of ['waiting_for_user', 'saving', 'paused', 'running']) {
    assert.equal(toolResultState(JSON.stringify({ status })), 'receipt accepted');
  }
});

test('public copy removes macOS paths and hardware descriptions before saving', () => {
  const notebook = { metadata: {}, cells: [
    { id: 'setup', cell_type: 'code', outputs: [{ output_type: 'stream', name: 'stdout',
      text: ['Saved: /var/folders/xy/private/lesson.ipynb\n'] }] },
    { id: 'capture-list_media_sources-inspect', cell_type: 'code', outputs: [{ output_type: 'stream',
      text: ['device label: Household microphone; device_id=opaque\n'] }] },
    { id: 'question', cell_type: 'markdown', metadata: { nbinlineai: { isPromptCell: true } }, source: ['Use tool.'] },
    { id: 'answer', cell_type: 'markdown', metadata: { nbinlineai: {
      isOutputCell: true, promptCellId: 'question' } }, source: ['Done.'] },
  ] };
  const trace = observedTrace('question', [
    { type: 'tool_start', id: 'a', name: 'list_media_sources', arguments: {} },
    { type: 'tool_result', id: 'a', name: 'list_media_sources', text: 'Household microphone' },
  ]);
  addTraceAppendix(notebook, trace);
  normalizePublicCopy(notebook);
  assertSafeNotebook(notebook);
  const encoded = JSON.stringify(notebook);
  assert.ok(!encoded.includes('/var/folders/'));
  assert.ok(!encoded.includes('Household microphone'));
  assert.equal(notebook.cells[4].metadata.questionCellId, 'question');
  assert.match(notebook.metadata.nbinlineaiWorked.savedCopyNormalization, /replaced/);
});

test('real device labels and IDs are removed from JSON, Python repr, and answer prose', () => {
  const json = '{"device_id":"OpaqueDevice123","label":"Bedroom wall camera"}';
  const python = "{'deviceId': 'OpaqueMic456', 'label': 'Mic'}";
  const privateValues = new Set([...sensitiveHardwareValues(json), ...sensitiveHardwareValues(python)]);
  const notebook = { metadata: {}, cells: [
    { id: 'json', cell_type: 'code', outputs: [{ output_type: 'stream', text: [json] }] },
    { id: 'repr', cell_type: 'code', outputs: [{ output_type: 'stream', text: [python] }] },
    { id: 'answer', cell_type: 'markdown', metadata: { nbinlineai: { isOutputCell: true } },
      source: ['I used Bedroom wall camera and Mic.'] },
  ] };
  normalizePublicCopy(notebook, privateValues);
  assertSafeNotebook(notebook);
  const saved = JSON.stringify(notebook);
  for (const value of ['OpaqueDevice123', 'Bedroom wall camera', 'OpaqueMic456', "'Mic'"]) {
    assert.ok(!saved.includes(value), `raw device value remained: ${value}`);
  }
});
