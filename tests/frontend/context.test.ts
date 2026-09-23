import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contextMode, contextRevisionKey, customSeed, emptySourceForMode, modeCandidateIds, notebookCells, precedingCells, snapshotTransportError, toolChoiceMetadata, toolDeclarationNames } from '../../src/context';
import { SSEParser, readEventStream } from '../../src/sse';

function fakeModel(cells: Array<{id: string; cell_type: string; source: string; metadata?: object; execution_count?: number | null}>): any {
  return { cells: { length: cells.length, get: (i: number) => ({
    id: cells[i].id, type: cells[i].cell_type,
    sharedModel: { getSource: () => cells[i].source },
    toJSON: () => cells[i]
  }) } };
}

test('context reads earlier models and preserves AI history, excluding later cells', () => {
  const model = fakeModel([
    { id: 'code', cell_type: 'code', source: 'x = 1', execution_count: null },
    { id: 'old-prompt', cell_type: 'markdown', source: 'Explain x', metadata: { nbinlineai: { isPromptCell: true } } },
    { id: 'old-answer', cell_type: 'markdown', source: 'x is one', metadata: { nbinlineai: { isOutputCell: true, promptCellId: 'old-prompt' } } },
    { id: 'new-prompt', cell_type: 'markdown', source: 'Next', metadata: { nbinlineai: { isPromptCell: true } } },
    { id: 'later', cell_type: 'code', source: 'y = 2' }
  ]);
  const result = precedingCells(model, 'new-prompt');
  assert.deepEqual(result.map(cell => cell.id), ['code', 'old-prompt', 'old-answer']);
  assert.equal(result[0].execution_count, null);
  assert.deepEqual(result[2].metadata, { nbinlineai: { isOutputCell: true, promptCellId: 'old-prompt' } });
  assert.throws(() => precedingCells(model, 'removed'), /removed/);
});

test('full snapshot reads below cells and Custom choices from live metadata', () => {
  const model = fakeModel([
    { id: 'before', cell_type: 'code', source: 'x = 1' },
    { id: 'prompt', cell_type: 'markdown', source: 'Explain' },
    { id: 'answer', cell_type: 'markdown', source: 'Old answer', metadata: { nbinlineai: { isOutputCell: true, promptCellId: 'prompt', status: 'done' } } },
    { id: 'later', cell_type: 'markdown', source: 'Note', metadata: { nbinlineai: { contextInclude: false } } }
  ]);
  const cells = notebookCells(model, 'prompt');
  assert.deepEqual(cells.map(cell => cell.id), ['before', 'prompt', 'answer', 'later']);
  assert.equal(cells[3].context_include, false);
  assert.deepEqual([...modeCandidateIds(cells, 'prompt', 'full-notebook')], ['before', 'later']);
  assert.deepEqual([...modeCandidateIds(cells, 'prompt', 'custom')], ['before']);
  assert.equal(contextMode('unexpected'), 'default');
});

test('ten-cell windows count physical positions without pulling linked answers', () => {
  const cells = [
    ...Array.from({ length: 12 }, (_, i) => ({ id: `before-${i}`, cell_type: i === 10 ? 'raw' : 'code', source: `x${i}` })),
    { id: 'moved-answer', cell_type: 'markdown', source: 'Answer', metadata: { nbinlineai: { isOutputCell: true, promptCellId: 'prompt', status: 'done' } } },
    { id: 'prompt', cell_type: 'markdown', source: 'Question' },
    ...Array.from({ length: 12 }, (_, i) => ({ id: `after-${i}`, cell_type: 'markdown', source: `text${i}` }))
  ];
  const model = fakeModel(cells);
  const snapshot = notebookCells(model, 'prompt');
  assert.deepEqual([...modeCandidateIds(snapshot, 'prompt', 'ten-above')],
    ['before-2', 'before-3', 'before-4', 'before-5', 'before-6', 'before-7', 'before-8', 'before-9', 'before-11']);
  assert.deepEqual([...modeCandidateIds(snapshot, 'prompt', 'ten-above-below')].slice(-10),
    Array.from({ length: 10 }, (_, i) => `after-${i}`));
});

test('eligibility excludes whitespace and orphan answers while missing Custom flags inherit true', () => {
  const snapshot = notebookCells(fakeModel([
    { id: 'space', cell_type: 'markdown', source: '  ' },
    { id: 'orphan', cell_type: 'markdown', source: 'answer', metadata: { nbinlineai: { role: 'response', prompt_cell_id: 'gone' } } },
    { id: 'question', cell_type: 'markdown', source: 'earlier', metadata: { nbinlineai: { role: 'prompt' } } },
    { id: 'answer', cell_type: 'markdown', source: 'complete', metadata: { nbinlineai: { role: 'response', prompt_cell_id: 'question' } } },
    { id: 'prompt', cell_type: 'markdown', source: 'now', metadata: { nbinlineai: { isPromptCell: true } } },
    { id: 'new', cell_type: 'code', source: 'z = 3' }
  ]), 'prompt');
  assert.deepEqual([...modeCandidateIds(snapshot, 'prompt', 'custom')], ['question', 'answer', 'new']);
  assert.equal(emptySourceForMode('  ', 'default'), false);
  assert.equal(emptySourceForMode('  ', 'all-above'), true);
});

test('Custom initialization writes every existing choice and preserves unrelated metadata', () => {
  const cells = notebookCells(fakeModel([
    { id: 'a', cell_type: 'code', source: 'x = 1', metadata: { nbinlineai: { keepAnswer: true }, tags: ['lesson'] } },
    { id: 'b', cell_type: 'raw', source: '', metadata: { nbinlineai: { status: 'draft' } } },
    { id: 'prompt', cell_type: 'markdown', source: 'Question', metadata: { nbinlineai: { isPromptCell: true } } }
  ]), 'prompt');
  const seeded = customSeed(cells, new Set(['a']), { id: 'a', checked: false });
  assert.deepEqual(seeded.map(item => item.ai.contextInclude), [false, false, false]);
  assert.equal(seeded[0].ai.keepAnswer, true);
  assert.deepEqual(cells[0].metadata?.tags, ['lesson']);
  assert.equal(cells[0].context_include, undefined);
  const restored = cells.map((cell, index) => ({ ...cell, context_include: seeded[index].ai.contextInclude as boolean }));
  assert.deepEqual([...modeCandidateIds(restored, 'prompt', 'custom')], []);
  const inserted = { id: 'new', cell_type: 'code', source: 'y = 2' };
  assert.deepEqual([...modeCandidateIds([...restored, inserted], 'prompt', 'custom')], ['new']);
});

test('preview revision changes for source, settings, mode, target and kernel', () => {
  const cells = notebookCells(fakeModel([
    { id: 'a', cell_type: 'code', source: 'x = 1' },
    { id: 'prompt', cell_type: 'markdown', source: 'Question' }
  ]), 'prompt');
  const base = contextRevisionKey(cells, 'prompt', 'default', 'session', 'kernel', { style: 'compact' });
  assert.notEqual(base, contextRevisionKey([{ ...cells[0], source: 'x = 2' }, cells[1]], 'prompt', 'default', 'session', 'kernel', { style: 'compact' }));
  assert.notEqual(base, contextRevisionKey(cells, 'prompt', 'default', 'session', 'kernel', { style: 'full' }));
  assert.notEqual(base, contextRevisionKey(cells, 'prompt', 'all-above', 'session', 'kernel', { style: 'compact' }));
  assert.notEqual(base, contextRevisionKey(cells, 'a', 'default', 'session', 'kernel', { style: 'compact' }));
  assert.notEqual(base, contextRevisionKey(cells, 'prompt', 'default', 'session', 'restarted', { style: 'compact' }));
});

test('snapshot transport reports cell and character limits before answer creation', () => {
  const small = [{ id: 'a', cell_type: 'code', source: 'x' }];
  assert.equal(snapshotTransportError(small), null);
  assert.match(snapshotTransportError(Array.from({ length: 10001 }, (_, i) => ({ id: String(i), cell_type: 'code', source: '' }))) || '', /10,000/);
  assert.match(snapshotTransportError([{ id: 'huge', cell_type: 'code', source: 'x'.repeat(4_000_000) }]) || '', /4,000,000/);
});

test('Current question only selects no optional text while tool preferences remain independent', () => {
  const snapshot = notebookCells(fakeModel([
    { id: 'decl', cell_type: 'markdown', source: '&`search_kernel_names` and &`read_url` and &`read_url`', metadata: { nbinlineai: { toolsInclude: false, contextInclude: true } } },
    { id: 'code', cell_type: 'code', source: '&`not_a_declaration`' },
    { id: 'answer', cell_type: 'markdown', source: '&`not_a_declaration`', metadata: { nbinlineai: { isOutputCell: true, promptCellId: 'old' } } },
    { id: 'prompt', cell_type: 'markdown', source: 'Use &`read_cell`', metadata: { nbinlineai: { isPromptCell: true } } }
  ]), 'prompt');
  assert.deepEqual([...modeCandidateIds(snapshot, 'prompt', 'current-only')], []);
  assert.deepEqual(toolDeclarationNames(snapshot[0]), ['search_kernel_names', 'read_url']);
  assert.deepEqual(toolDeclarationNames(snapshot[1]), []);
  assert.deepEqual(toolDeclarationNames(snapshot[2]), []);
  assert.deepEqual(toolDeclarationNames(snapshot[3]), ['read_cell']);
  assert.equal(snapshot[0].tools_include, false);
  assert.equal(snapshot[3].tools_include, undefined);
  assert.equal(contextMode('current-only'), 'current-only');
  assert.deepEqual(toolChoiceMetadata({ contextInclude: false, keepAnswer: true }, false),
    { contextInclude: false, keepAnswer: true, toolsInclude: false });
});

test('SSE parses split data and CRLF boundaries', () => {
  const parser = new SSEParser();
  assert.deepEqual(parser.push('data: {"type":"text_'), []);
  assert.deepEqual(parser.push('delta","text":"Hi"}\r'), []);
  assert.deepEqual(parser.push('\n\r'), []);
  assert.deepEqual(parser.push('\n'), [{ type: 'text_delta', text: 'Hi' }]);
  assert.deepEqual(parser.push('data: {"type":"done"}\n\n'), [{ type: 'done' }]);
});

test('stream decodes split UTF-8 and propagates callback errors', async () => {
  const bytes = new TextEncoder().encode('data: {"type":"text_delta","text":"café"}\n\n');
  const split = bytes.indexOf(0xc3) + 1;
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, split));
      controller.enqueue(bytes.slice(split));
      controller.close();
    }
  }));
  const events: unknown[] = [];
  await readEventStream(response, event => events.push(event));
  assert.deepEqual(events, [{ type: 'text_delta', text: 'café' }]);
  await assert.rejects(
    readEventStream(new Response('data: {"type":"error","message":"failed"}\n\n'), () => { throw new Error('failed'); }),
    /failed/
  );
});

test('callback failure cancels network stream', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode('data: {"type":"error"}\n\n')); },
    cancel() { cancelled = true; }
  }));
  await assert.rejects(readEventStream(response, () => { throw new Error('stop'); }), /stop/);
  assert.equal(cancelled, true);
});

test('stream waits for a notebook action reply before reading later events', async () => {
  const response = new Response('data: {"type":"frontend_action"}\n\ndata: {"type":"done"}\n\n');
  const seen: string[] = [];
  await readEventStream(response, async event => {
    if (event.type === 'frontend_action') {
      await new Promise<void>(resolve => setTimeout(resolve, 5));
      seen.push('reply accepted');
    } else {
      seen.push(event.type);
    }
  });
  assert.deepEqual(seen, ['reply accepted', 'done']);
});
