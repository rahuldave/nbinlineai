import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NotebookActionBridge } from '../../src/frontendActions';

type Cell = { id: string; type: string; source: string; ai?: Record<string, unknown>;
  metadata?: Record<string, unknown>; attachments?: Record<string, unknown>;
  outputs?: unknown[]; execution_count?: number | null };
function fakeNotebook(initial: Cell[]) {
  const cells = initial.slice();
  let next = 0;
  return {
    cells: { get length() { return cells.length; }, get: (index: number) => ({
      id: cells[index].id,
      type: cells[index].type,
      sharedModel: { getSource: () => cells[index].source,
        setSource: (source: string) => { cells[index].source = source; },
        toJSON: () => ({ metadata: cells[index].metadata || {} }),
        getAttachments: () => cells[index].attachments,
        setAttachments: (attachments: Record<string, unknown>) => { cells[index].attachments = attachments; },
        setMetadata: (key: string, value: unknown) => { (cells[index].metadata ||= {})[key] = value; },
        setOutputs: (outputs: unknown[]) => { cells[index].outputs = outputs; },
        get execution_count() { return cells[index].execution_count; },
        set execution_count(count: number | null | undefined) { cells[index].execution_count = count; }
      },
      getMetadata: (key: string) => key === 'nbinlineai' ? cells[index].ai : undefined
    }) },
    sharedModel: {
      transact: (fn: () => void) => fn(),
      insertCell: (index: number, value: { cell_type: string; source: string; metadata?: Record<string, unknown>; attachments?: Record<string, unknown> }) => {
        cells.splice(index, 0, { id: `new-${++next}`, type: value.cell_type, source: value.source, metadata: value.metadata, attachments: value.attachments });
      },
      deleteCell: (index: number) => { cells.splice(index, 1); },
      moveCell: (from: number, to: number) => {
        const [cell] = cells.splice(from, 1);
        cells.splice(from > to ? to : to, 0, cell);
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
  assert.equal(bridge.perform({ request_id: 'bad-read', name: 'read_cell', arguments: { cell_id: 'prompt', execute: true } })?.ok, false);
  assert.equal(bridge.perform({ request_id: 'bad-list', name: 'list_cells', arguments: { save: true } })?.ok, false);
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

test('finds unsaved cells and rejects stale edits or AI-cell edits', () => {
  const notebook = fakeNotebook([
    { id: 'prompt', type: 'markdown', source: 'Ask', ai: { isPromptCell: true } },
    { id: 'answer', type: 'markdown', source: 'Reply', ai: { isOutputCell: true } },
    { id: 'code', type: 'code', source: 'value = 1\nprint(value)', outputs: [{ output_type: 'stream' }], execution_count: 3 }
  ]);
  const bridge = new NotebookActionBridge(notebook as any, 'prompt', 'answer');
  const call = (name: string, args: Record<string, unknown>) => bridge.perform({ request_id: `${name}-${Math.random()}`, name, arguments: args });
  const found = JSON.parse(call('find_cells', { query: 'value', cell_type: 'code' })?.text || '{}');
  assert.deepEqual(found.matches.map((match: { cell_id: string }) => match.cell_id), ['code']);
  assert.equal(call('replace_cell', { cell_id: 'code', expected_source: 'old', new_source: 'value = 2' })?.ok, false);
  assert.equal(call('replace_cell', { cell_id: 'prompt', expected_source: 'Ask', new_source: 'Changed' })?.ok, false);
  assert.equal(call('replace_cell', { cell_id: 'code', expected_source: 'value = 1\nprint(value)', new_source: 'value = 2' })?.ok, true);
  assert.equal(notebook.raw[2].source, 'value = 2');
  assert.deepEqual(notebook.raw[2].outputs, []);
  assert.equal(notebook.raw[2].execution_count, null);
  assert.equal(call('cell_str_replace', { cell_id: 'code', old_str: 'value', new_str: 'number', expected_matches: 2 })?.ok, false);
  assert.equal(call('replace_cell', { cell_id: 'code', expected_source: 'value = 2', new_source: 'bad', execute: true })?.ok, false);
});

test('find_cells reports partial coverage under both cell and source work limits', () => {
  const many: Cell[] = [
    { id: 'prompt', type: 'markdown', source: 'Ask', ai: { isPromptCell: true } },
    { id: 'answer', type: 'markdown', source: 'Reply', ai: { isOutputCell: true } }
  ];
  for (let i = 0; i < 1998; i++) many.push({ id: `ordinary-${i}`, type: 'code', source: 'small' });
  many.push({ id: 'late', type: 'code', source: 'FIND_ME_AFTER_CELL_LIMIT' });
  const notebook = fakeNotebook(many);
  const bridge = new NotebookActionBridge(notebook as any, 'prompt', 'answer');
  const byCells = JSON.parse(bridge.perform({ request_id: 'search-cells', name: 'find_cells',
    arguments: { query: 'FIND_ME_AFTER_CELL_LIMIT' } })?.text || '{}');
  assert.deepEqual(byCells.matches, []);
  assert.equal(byCells.scanned_cells, 2000);
  assert.equal(byCells.partial, true);
  assert.equal(byCells.total, null);
  const huge = fakeNotebook([
    { id: 'prompt', type: 'markdown', source: 'Ask', ai: { isPromptCell: true } },
    { id: 'answer', type: 'markdown', source: 'Reply', ai: { isOutputCell: true } },
    { id: 'huge', type: 'code', source: 'x'.repeat(2_000_001) + 'FIND_ME_AFTER_SOURCE_LIMIT' },
    { id: 'later', type: 'code', source: 'FIND_ME_AFTER_SOURCE_LIMIT' }
  ]);
  const byChars = JSON.parse(new NotebookActionBridge(huge as any, 'prompt', 'answer').perform({
    request_id: 'search-chars', name: 'find_cells', arguments: { query: 'FIND_ME_AFTER_SOURCE_LIMIT' }
  })?.text || '{}');
  assert.deepEqual(byChars.matches, []);
  assert.equal(byChars.scanned_cells, 3);
  assert.equal(byChars.partial, true);
  assert.equal(byChars.total, null);
  assert.equal(byChars.truncated, true);
});

test('line edits, split, copy, move, merge and delete use stable IDs', () => {
  const notebook = fakeNotebook([
    { id: 'prompt', type: 'markdown', source: 'Ask', ai: { isPromptCell: true } },
    { id: 'answer', type: 'markdown', source: 'Reply', ai: { isOutputCell: true } },
    { id: 'a', type: 'code', source: 'one\ntwo', metadata: { tags: ['lesson'] } },
    { id: 'b', type: 'code', source: 'three' }
  ]);
  const bridge = new NotebookActionBridge(notebook as any, 'prompt', 'answer');
  let count = 0;
  const call = (name: string, args: Record<string, unknown>) => bridge.perform({ request_id: `edit-${++count}`, name, arguments: args });
  assert.equal(call('cell_insert_line', { cell_id: 'a', line: 2, content: 'middle', expected_source: 'one\ntwo' })?.ok, true);
  assert.equal(notebook.raw[2].source, 'one\nmiddle\ntwo');
  assert.equal(call('cell_replace_lines', { cell_id: 'a', start_line: 2, end_line: 2, content: 'TWO', expected_source: 'one\nmiddle\ntwo' })?.ok, true);
  assert.equal(call('split_cell', { cell_id: 'a', line: 2, expected_source: 'one\nTWO\ntwo' })?.ok, true);
  assert.deepEqual(notebook.raw.map(cell => cell.id), ['prompt', 'answer', 'a', 'new-1', 'b']);
  assert.equal(notebook.raw[3].source, 'TWO\ntwo');
  assert.deepEqual(notebook.raw[3].metadata, { tags: ['lesson'] });
  assert.equal(call('merge_cells', { first_cell_id: 'a', second_cell_id: 'new-1', expected_first: 'one', expected_second: 'TWO\ntwo' })?.ok, true);
  assert.equal(notebook.raw[2].source, 'one\nTWO\ntwo');
  assert.equal(call('copy_cell', { cell_id: 'a', after_cell_id: 'b' })?.ok, true);
  assert.deepEqual(notebook.raw.map(cell => cell.id), ['prompt', 'answer', 'a', 'b', 'new-2']);
  assert.deepEqual(notebook.raw[4].metadata, { tags: ['lesson'] });
  assert.match(call('move_cell', { cell_id: 'new-2', after_cell_id: 'a' })?.text || '', /Moved cell new-2/);
  assert.deepEqual(notebook.raw.map(cell => cell.id), ['prompt', 'answer', 'a', 'new-2', 'b']);
  assert.equal(call('delete_cell', { cell_id: 'new-2', expected_source: 'stale' })?.ok, false);
  assert.equal(call('delete_cell', { cell_id: 'new-2', expected_source: 'one\nTWO\ntwo' })?.ok, true);
  assert.deepEqual(notebook.raw.map(cell => cell.id), ['prompt', 'answer', 'a', 'b']);
  assert.equal(call('move_cell', { cell_id: 'b', after_cell_id: 'prompt' })?.ok, false);
});

test('markdown copy and split retain attachments; merge preserves disjoint fields and rejects conflicts', () => {
  const attachment = { 'figure.png': { 'image/png': 'aGVsbG8=' } };
  const notebook = fakeNotebook([
    { id: 'prompt', type: 'markdown', source: 'Ask', ai: { isPromptCell: true } },
    { id: 'answer', type: 'markdown', source: 'Reply', ai: { isOutputCell: true } },
    { id: 'one', type: 'markdown', source: 'A\nB', metadata: { tags: ['one'] }, attachments: attachment },
    { id: 'two', type: 'markdown', source: 'C', metadata: { custom: 7 }, attachments: { 'other.png': { 'image/png': 'Yg==' } } }
  ]);
  const bridge = new NotebookActionBridge(notebook as any, 'prompt', 'answer');
  let n = 0;
  const call = (name: string, args: Record<string, unknown>) => bridge.perform({ request_id: `attachment-${++n}`, name, arguments: args });
  assert.equal(call('copy_cell', { cell_id: 'one', after_cell_id: 'two' })?.ok, true);
  assert.deepEqual(notebook.raw[4].attachments, attachment);
  assert.equal(call('split_cell', { cell_id: 'one', line: 2, expected_source: 'A\nB' })?.ok, true);
  assert.deepEqual(notebook.raw[3].attachments, attachment);
  assert.equal(call('merge_cells', { first_cell_id: 'new-2', second_cell_id: 'two', expected_first: 'B', expected_second: 'C' })?.ok, true);
  assert.deepEqual(notebook.raw[3].metadata, { tags: ['one'], custom: 7 });
  assert.deepEqual(Object.keys(notebook.raw[3].attachments || {}).sort(), ['figure.png', 'other.png']);
  notebook.raw[2].metadata = { tags: ['different'] };
  const before = notebook.raw.map(cell => cell.source);
  assert.equal(call('merge_cells', { first_cell_id: 'one', second_cell_id: 'new-2', expected_first: 'A', expected_second: 'B\nC' })?.ok, false);
  assert.deepEqual(notebook.raw.map(cell => cell.source), before);
});
