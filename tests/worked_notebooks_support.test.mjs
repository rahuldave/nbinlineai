import test from 'node:test';
import assert from 'node:assert/strict';
import { observedTrace, normalizePublicCopy, addTraceAppendix, assertSafeNotebook,
  toolResultState } from '../scripts/worked_notebooks_support.mjs';

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
