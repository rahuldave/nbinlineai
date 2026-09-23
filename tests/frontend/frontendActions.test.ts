import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NotebookActionBridge } from '../../src/frontendActions';

type Cell = { id: string; type: string; source: string; ai?: Record<string, unknown> };
function fakeNotebook(initial: Cell[]) {
  const cells = initial.slice();
  let next = 0;
  return {
    cells: { get length() { return cells.length; }, get: (index: number) => ({
      id: cells[index].id,
      type: cells[index].type,
      sharedModel: { getSource: () => cells[index].source },
      getMetadata: (key: string) => key === 'nbinlineai' ? cells[index].ai : undefined
    }) },
    sharedModel: {
      transact: (fn: () => void) => fn(),
      insertCell: (index: number, value: { cell_type: string; source: string }) => {
        cells.splice(index, 0, { id: `new-${++next}`, type: value.cell_type, source: value.source });
      }
    },
    raw: cells
  };
}

test('reads live notebook models, including unsaved cells after the AI prompt', () => {
  const notebook = fakeNotebook([
    { id: 'prompt', type: 'markdown', source: 'Ask', ai: { isPromptCell: true } },
    { id: 'answer', type: 'markdown', source: 'Reply', ai: { isOutputCell: true, promptCellId: 'prompt', status: 'done' } },
    { id: 'later', type: 'code', source: 'uncommitted = 42' }
  ]);
  const bridge = new NotebookActionBridge(notebook as any, 'prompt', 'answer');
  const listed = bridge.perform({ request_id: 'one', name: 'list_cells', arguments: {} });
  assert.equal(listed?.ok, true);
  assert.deepEqual(JSON.parse(listed?.text || '{}').cells.map((cell: { cell_id: string }) => cell.cell_id), ['prompt', 'answer', 'later']);
  assert.deepEqual({ total: JSON.parse(listed?.text || '{}').total, next_start: JSON.parse(listed?.text || '{}').next_start },
    { total: 3, next_start: null });
  assert.equal(bridge.perform({ request_id: 'two', name: 'read_cell', arguments: { cell_id: 'later', start_line: 1, end_line: 2 } })?.text,
    '1: uncommitted = 42');
  assert.equal(bridge.perform({ request_id: 'two', name: 'read_cell', arguments: { end_line: 2, start_line: 1, cell_id: 'later' } }), null);
});

test('inserts after the paired answer in stable order and never inserts twice for a repeated ID', () => {
  const notebook = fakeNotebook([
    { id: 'prompt', type: 'markdown', source: 'Ask', ai: { isPromptCell: true } },
    { id: 'answer', type: 'markdown', source: 'Reply', ai: { isOutputCell: true, promptCellId: 'prompt' } },
    { id: 'next', type: 'code', source: 'x = 1' }
  ]);
  const bridge = new NotebookActionBridge(notebook as any, 'prompt', 'answer');
  const first = { request_id: 'insert-1', name: 'insert_markdown', arguments: { content: 'First note' } };
  assert.deepEqual(bridge.perform(first), { ok: true, cell_id: 'new-1' });
  assert.equal(bridge.perform(first), null);
  assert.equal(bridge.perform({ ...first, arguments: { content: 'First note' } }), null);
  assert.deepEqual(bridge.perform({ request_id: 'insert-2', name: 'insert_markdown', arguments: { content: 'Second note' } }), { ok: true, cell_id: 'new-2' });
  assert.deepEqual(notebook.raw.map(cell => cell.id), ['prompt', 'answer', 'new-1', 'new-2', 'next']);
  assert.throws(() => bridge.perform({ ...first, arguments: { content: 'Different note' } }), /reused/);
});

test('explicit prompt anchor is honored exactly and missing cells return errors', () => {
  const notebook = fakeNotebook([
    { id: 'prompt', type: 'markdown', source: 'Ask', ai: { isPromptCell: true } },
    { id: 'answer', type: 'markdown', source: 'Reply', ai: { isOutputCell: true, promptCellId: 'prompt' } }
  ]);
  const bridge = new NotebookActionBridge(notebook as any, 'prompt', 'answer');
  assert.equal(bridge.perform({ request_id: 'insert', name: 'insert_markdown', arguments: { content: 'A', after_cell_id: 'prompt' } })?.ok, true);
  assert.deepEqual(notebook.raw.map(cell => cell.id), ['prompt', 'new-1', 'answer']);
  assert.match(bridge.perform({ request_id: 'missing', name: 'read_cell', arguments: { cell_id: 'gone' } })?.text || '', /removed/);
  assert.equal(bridge.perform({ request_id: 'bad', name: 'insert_markdown', arguments: { content: ' ' } })?.ok, false);
});

test('listing paginates and long reads show an explicit truncation notice', () => {
  const notebook = fakeNotebook([
    { id: 'prompt', type: 'markdown', source: 'Ask', ai: { isPromptCell: true } },
    { id: 'answer', type: 'markdown', source: 'Reply', ai: { isOutputCell: true, promptCellId: 'prompt' } },
    { id: 'huge', type: 'code', source: 'x'.repeat(5000) }
  ]);
  const bridge = new NotebookActionBridge(notebook as any, 'prompt', 'answer');
  const page = JSON.parse(bridge.perform({ request_id: 'page', name: 'list_cells', arguments: { start: 0, limit: 2 } })?.text || '{}');
  assert.deepEqual({ total: page.total, next_start: page.next_start, truncated: page.truncated },
    { total: 3, next_start: 2, truncated: true });
  const read = bridge.perform({ request_id: 'read', name: 'read_cell', arguments: { cell_id: 'huge' } })?.text || '';
  assert.equal(read.length, 4000);
  assert.match(read, /\[truncated; narrow the line range\]$/);
});

test('mixed note and code insertions share stable order and code stays unexecuted', () => {
  const notebook = fakeNotebook([
    { id: 'prompt', type: 'markdown', source: 'Ask', ai: { isPromptCell: true } },
    { id: 'answer', type: 'markdown', source: 'Reply', ai: { isOutputCell: true, promptCellId: 'prompt' } },
    { id: 'next', type: 'code', source: 'print("already present")' }
  ]);
  const bridge = new NotebookActionBridge(notebook as any, 'prompt', 'answer');
  const code = { request_id: 'code-1', name: 'insert_code', arguments: { content: 'print("suggested")' } };
  assert.deepEqual(bridge.perform(code), { ok: true, cell_id: 'new-1' });
  assert.equal(bridge.perform(code), null);
  assert.deepEqual(bridge.perform({ request_id: 'note-2', name: 'insert_markdown', arguments: { content: 'Explanation' } }),
    { ok: true, cell_id: 'new-2' });
  assert.deepEqual(bridge.perform({ request_id: 'code-3', name: 'insert_code', arguments: {
    content: 'result = 42', after_cell_id: 'prompt'
  } }), { ok: true, cell_id: 'new-3' });
  assert.deepEqual(notebook.raw.map(cell => [cell.id, cell.type]), [
    ['prompt', 'markdown'], ['new-3', 'code'], ['answer', 'markdown'],
    ['new-1', 'code'], ['new-2', 'markdown'], ['next', 'code']
  ]);
  assert.deepEqual(notebook.raw.find(cell => cell.id === 'new-1')?.ai, undefined);
  assert.equal(bridge.perform({ request_id: 'bad-execute', name: 'insert_code', arguments: {
    content: 'print("do not run")', execute: true
  } })?.ok, false);
  assert.equal(notebook.raw.length, 6);
});
