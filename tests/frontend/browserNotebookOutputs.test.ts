import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OutputLedger, exportOutput, readOutput } from '../../src/browserNotebookOutputs';
import { pythonResultChars } from '../../src/browserMediaResultBudget';

function signal() {
  const listeners = new Set<() => void>();
  return { connect: (listener: () => void) => { listeners.add(listener); },
    disconnect: (listener: () => void) => { listeners.delete(listener); },
    emit: () => listeners.forEach(listener => listener()) };
}
function output(text: string) {
  const changed = signal();
  const streamChanged = signal();
  const streamText = { text, changed: streamChanged };
  return { type: 'stream', data: {}, changed, streamText,
    toJSON: () => ({ output_type: 'stream', text: streamText.text }) };
}
function fixture() {
  const changed = signal();
  const items = [output('first'), output('second')];
  const code = { id: 'cell', type: 'code', outputs: {
    changed, get length() { return items.length; }, get: (index: number) => items[index]
  } };
  const context = { isCurrent: () => true, addCleanup: (_: () => void) => undefined,
    panel: { content: { model: { cells: { changed: signal(), length: 1, get: () => code } } } } };
  const ledger = new OutputLedger(context as never);
  return { ledger, items, changed, context };
}

test('output identity survives index shifts but replacement, stream append, and removal invalidate', () => {
  const { ledger, items, changed } = fixture();
  const refs = ledger.list('cell', '', 10).outputs;
  assert.equal(refs.length, 2);
  assert.equal(readOutput(ledger, { cell_id: 'cell', output_id: refs[1].output_id,
    revision: refs[1].revision }).text, 'second');
  items.unshift(output('before'));
  changed.emit();
  assert.equal(ledger.resolve('cell', refs[1].output_id, refs[1].revision).index, 2);
  items[2].streamText.text += ' changed';
  items[2].streamText.changed.emit();
  assert.throws(() => ledger.resolve('cell', refs[1].output_id, refs[1].revision), /changed or expired/);
  const fresh = ledger.list('cell', '', 10).outputs[2];
  assert.equal(readOutput(ledger, { cell_id: 'cell', output_id: fresh.output_id,
    revision: fresh.revision, start: 7, max_chars: 4 }).text, 'chan');
  items[2] = output('second changed');
  changed.emit();
  assert.throws(() => ledger.resolve('cell', fresh.output_id, fresh.revision), /changed or expired/);
  assert.notEqual(ledger.list('cell', '', 10).outputs[2].output_id, fresh.output_id);
  ledger.dispose();
});

test('output list cursor expires after structural mutation', () => {
  const { ledger, items, changed } = fixture();
  const page = ledger.list('cell', '', 1);
  assert.ok(page.next_cursor);
  items.unshift(output('new'));
  changed.emit();
  assert.throws(() => ledger.list('cell', page.next_cursor!, 1), /Output list changed/);
  ledger.dispose();
});

test('2000-character ASCII and Unicode output pages fit server JSON and reassemble exactly', () => {
  for (const text of ['x'.repeat(2000), 'é😀'.repeat(700)]) {
    const { ledger, items } = fixture();
    items[0].streamText.text = text;
    const ref = ledger.list('cell', '', 10).outputs[0];
    let start = 0;
    let rebuilt = '';
    do {
      const result = readOutput(ledger, { cell_id: 'cell', output_id: ref.output_id,
        revision: ref.revision, start, max_chars: 2000 });
      assert.ok(pythonResultChars(result) <= 1400);
      const page = result.text as string;
      assert.ok(page.length > 0);
      assert.ok(!/[\ud800-\udbff]$/.test(page));
      rebuilt += page;
      if (result.next_start === null) break;
      start = result.next_start as number;
    } while (start < text.length);
    assert.equal(rebuilt, text);
    ledger.dispose();
  }
});

test('large structured table is rejected before eager JSON stringify', () => {
  const { ledger, items, changed } = fixture();
  const table = { data: Array.from({ length: 300_000 }, (_, index) => index) };
  items[0] = { type: 'display_data', data: { 'application/vnd.dataresource+json': table },
    changed: signal() } as never;
  changed.emit();
  const ref = ledger.list('cell', '', 10).outputs[0];
  const original = JSON.stringify;
  JSON.stringify = ((value: unknown, ...args: unknown[]) => {
    if (value === table) throw new Error('Eager stringify was attempted');
    return original(value, ...args as []);
  }) as typeof JSON.stringify;
  try {
    assert.throws(() => readOutput(ledger, { cell_id: 'cell', output_id: ref.output_id,
      revision: ref.revision, mime: 'application/vnd.dataresource+json' }), /too large/);
  } finally { JSON.stringify = original; ledger.dispose(); }
});

test('export keeps JSON and data-resource MIME as exact UTF-8 bytes and refuses HTML', async () => {
  const { items, changed, context } = fixture();
  const payload = { columns: ['color'], data: [['é😀']] };
  items[0] = { type: 'display_data', data: { 'application/vnd.dataresource+json': payload,
    'application/json': { answer: 42 }, 'text/html': '<script>unsafe()</script>' },
    changed: signal() } as never;
  changed.emit();
  const uploads: Array<{ bytes: Uint8Array; mime: string; saveTo: string | null }> = [];
  const live = { ...context, addOperationCleanup: () => undefined,
    upload: async (_id: string, bytes: Uint8Array, mime: string, _hash: string,
      _metadata: object, saveTo: string | null) => { uploads.push({ bytes, mime, saveTo }); } };
  // Resolve the same model through the context-owned ledger used by exportOutput.
  const { outputLedger } = await import('../../src/browserNotebookOutputs');
  const ref = outputLedger(live as never).list('cell', '', 10).outputs[0];
  await exportOutput(live as never, { operation_id: 'export', status: 'running' },
    { cell_id: 'cell', output_id: ref.output_id, revision: ref.revision,
      mime: 'application/vnd.dataresource+json', save_to: 'auto' });
  assert.equal(uploads[0].mime, 'application/vnd.dataresource+json');
  assert.equal(new TextDecoder().decode(uploads[0].bytes), JSON.stringify(payload));
  assert.equal(uploads[0].saveTo, 'auto');
  await exportOutput(live as never, { operation_id: 'export2', status: 'running' },
    { cell_id: 'cell', output_id: ref.output_id, revision: ref.revision,
      mime: 'application/json', save_to: null });
  assert.equal(new TextDecoder().decode(uploads[1].bytes), '{"answer":42}');
  await assert.rejects(exportOutput(live as never, { operation_id: 'bad', status: 'running' },
    { cell_id: 'cell', output_id: ref.output_id, revision: ref.revision, mime: 'text/html' }), /supported existing/);
});
