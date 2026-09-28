import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OutputLedger, readOutput } from '../../src/browserNotebookOutputs';

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
  return { ledger, items, changed };
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
