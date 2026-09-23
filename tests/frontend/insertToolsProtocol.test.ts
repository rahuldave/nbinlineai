import { test } from 'node:test';
import assert from 'node:assert/strict';
import { insertionIndex, parseInsertRequest } from '../../src/insertToolsProtocol';

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
