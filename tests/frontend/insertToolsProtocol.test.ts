import { test } from 'node:test';
import assert from 'node:assert/strict';
import { insertionIndex, parseExecutionHandoffRequest, parseInsertRequest } from '../../src/insertToolsProtocol';

const request = {
  version: 1, content: 'Available tools:\n- &`read_cell` — Read live source.',
  source_cell_id: 'code-a', execute_request_id: 'execute-123'
};

test('accepts only bounded generated Markdown tied to a code execution', () => {
  assert.deepEqual(parseInsertRequest(request), request);
  assert.equal(parseInsertRequest({ ...request, content: '  ' }), null);
  assert.equal(parseInsertRequest({ ...request, content: 'x'.repeat(8001) }), null);
  assert.equal(parseInsertRequest({ ...request, source_cell_id: '' }), null);
  assert.equal(parseInsertRequest({ ...request, execute_request_id: '' }), null);
  assert.equal(parseInsertRequest({ ...request, version: 2 }), null);
  assert.equal(parseInsertRequest(['insert', request]), null);
});

test('first and repeated notes remain immediately after their source in call order', () => {
  assert.equal(insertionIndex(['intro', 'code-a', 'next'], 'code-a'), 2);
  assert.equal(insertionIndex(['intro', 'code-a', 'note-1', 'next'], 'code-a', 'note-1'), 3);
  assert.equal(insertionIndex(['intro', 'code-a', 'next'], 'code-a', 'deleted-note'), 2);
  assert.throws(() => insertionIndex(['intro', 'next'], 'code-a'), /removed/);
});

test('direct handoff comm is versioned and bound to an execution and request', () => {
  const value = { version: 1, operation: 'run_and_prompt', arguments: { cell_id: 'c1', prompt: 'Explain' },
    source_cell_id: 'caller', execute_request_id: 'msg-1', request_id: 'request-1' };
  assert.deepEqual(parseExecutionHandoffRequest(value), value);
  assert.equal(parseExecutionHandoffRequest({ ...value, execute_request_id: '' }), null);
  assert.equal(parseExecutionHandoffRequest({ ...value, request_id: '' }), null);
  assert.equal(parseExecutionHandoffRequest({ ...value, operation: 'execute_arbitrary' }), null);
  assert.equal(parseExecutionHandoffRequest({ ...value, version: 2 }), null);
});
