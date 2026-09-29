import test from 'node:test';
import assert from 'node:assert/strict';
import { observedTrace, normalizePublicCopy, addTraceAppendix, assertSafeNotebook,
  sensitiveHardwareValues, toolResultState, liveCellIndex, boundKernelSession,
  verifiedCodeWidgetSource } from '../scripts/worked_notebooks_support.mjs';

test('current live cell IDs select the changed model order, not source ordinals', () => {
  const cells = [
    { id: 'intro', cell_type: 'markdown', metadata: {} },
    { id: 'inserted', cell_type: 'code', metadata: {} },
    { id: 'question', cell_type: 'markdown', metadata: { nbinlineai: { isPromptCell: true } } },
    { id: 'setup', cell_type: 'code', metadata: {} },
  ];
  assert.equal(liveCellIndex(cells, 'setup', 'code'), 3);
  assert.equal(liveCellIndex(cells, 'question', 'question'), 2);
  assert.throws(() => liveCellIndex([...cells, cells[3]], 'setup', 'code'), /duplicated/);
  assert.throws(() => liveCellIndex(cells, 'intro', 'question'), /wrong type/);
  assert.throws(() => liveCellIndex(cells, '"bad-selector', 'code'), /invalid/);
});

test('save and session identity fail closed on stale same-type order or duplicate path', () => {
  const first = { id: 'a', cell_type: 'code', source: 'print(1)' };
  const second = { id: 'b', cell_type: 'code', source: 'print(2)' };
  assert.equal(liveCellIndex([second, first], 'a', 'code'), 1);
  assert.equal(verifiedCodeWidgetSource(first, 'print(1)'), first);
  assert.throws(() => verifiedCodeWidgetSource(first, 'print(2)'), /disagree/);
  const created = { id: 'session-new', path: 'owned.ipynb', kernel: { id: 'kernel-new' } };
  assert.equal(boundKernelSession(created, [created], 'owned.ipynb'), 'kernel-new');
  assert.throws(() => boundKernelSession(created, [created, { ...created, id: 'stale' }], 'owned.ipynb'),
    /multiple kernel/);
  assert.throws(() => boundKernelSession(created, [{ ...created, id: 'stale' }], 'owned.ipynb'),
    /changed its owned/);
});

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

test('structured evidence links accepted operation to later status without private device data', () => {
  const operationId = 'AbCdEf0123456789_-AbCdEf01234567';
  const first = observedTrace('start-question', [
    { type: 'tool_start', id: 'start', name: 'start_camera', arguments: { audio: false } },
    { type: 'frontend_action', run_id: 'run', request_id: 'request' },
    { type: 'tool_result', id: 'start', name: 'start_camera',
      text: JSON.stringify({ operation_id: operationId, status: 'accepted', device_id: 'Private123' }) },
  ]);
  const later = observedTrace('status-question', [
    { type: 'tool_start', id: 'status', name: 'operation_status', arguments: { operation_id: operationId } },
    { type: 'tool_result', id: 'status', name: 'operation_status',
      text: JSON.stringify({ operation_id: operationId, status: 'completed' }) },
  ]);
  const notebook = { cells: [
    { id: 'start-answer', cell_type: 'markdown', metadata: { nbinlineai: {
      isOutputCell: true, promptCellId: 'start-question' } }, source: ['Started.'] },
    { id: 'status-answer', cell_type: 'markdown', metadata: { nbinlineai: {
      isOutputCell: true, promptCellId: 'status-question' } }, source: ['Completed.'] },
  ] };
  addTraceAppendix(notebook, [...first, ...later]);
  const start = notebook.cells.find(cell => cell.id === 'worked-trace-start-question');
  const status = notebook.cells.find(cell => cell.id === 'worked-trace-status-question');
  assert.deepEqual(start.metadata.nbinlineaiWorkedEvidence.observedTools[0], {
    name: 'start_camera', resultState: 'receipt accepted', frontendAction: true,
    operationId, operationState: 'accepted',
  });
  assert.equal(status.metadata.nbinlineaiWorkedEvidence.observedTools[0].targetOperationId, operationId);
  assert.equal(status.metadata.nbinlineaiWorkedEvidence.observedTools[0].operationState, 'completed');
  assert.ok(!JSON.stringify(start.metadata).includes('Private123'));
  const untrusted = observedTrace('question', [
    { type: 'tool_start', id: 'x', name: 'operation_status', arguments: {} },
    { type: 'tool_result', id: 'x', name: 'operation_status',
      text: JSON.stringify({ status: 'private arbitrary status text '.repeat(100) }) },
  ]);
  assert.equal(untrusted[0].operationState, undefined);
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
