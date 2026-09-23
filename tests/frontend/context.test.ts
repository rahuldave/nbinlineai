import { test } from 'node:test';
import assert from 'node:assert/strict';
import { precedingCells } from '../../src/context';
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
