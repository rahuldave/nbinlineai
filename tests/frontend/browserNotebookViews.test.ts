import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readNotebookView, readSelection } from '../../src/browserNotebookViews';
import { pythonResultChars } from '../../src/browserMediaResultBudget';

function fixture(source: string) {
  const bounds = { top: 0, bottom: 100, left: 0, right: 100, width: 100, height: 100 };
  const widget = { model: { id: 'question', sharedModel: { getSource: () => source } },
    isPlaceholder: () => false, isDisposed: false,
    node: { isConnected: true, getBoundingClientRect: () => bounds },
    editor: { hasFocus: () => true, getSelection: () => ({ start: 0, end: source.length }),
      getOffsetAt: (point: number) => point } };
  const selectedCells = Array.from({ length: 12 }, (_, index) => ({ model: { id: `${index}-` + 'é'.repeat(180) } }));
  const notebook = { node: { getBoundingClientRect: () => bounds }, widgets: [widget],
    activeCell: widget, activeCellIndex: 0, selectedCells, mode: 'edit',
    model: { cells: { length: 13 } } };
  const context = { isCurrent: () => true, panel: { content: notebook,
    node: { contains: () => true } } };
  return context as never;
}

test('selected notebook view IDs paginate within Python server admission', () => {
  const result = readNotebookView(fixture('text'));
  assert.ok(pythonResultChars(result) <= 1400);
  assert.equal(result.selected_truncated, true);
  assert.ok((result.selected_cell_ids as string[]).length < 12);
});

test('Unicode selection is clipped on a codepoint boundary below server admission', () => {
  const old = globalThis.document;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { activeElement: {} } });
  try {
    const result = readSelection(fixture('é😀'.repeat(700)), 2000);
    assert.ok(pythonResultChars(result) <= 1400);
    assert.equal(result.truncated, true);
    assert.ok(!/[\ud800-\udbff]$/.test(result.text as string));
  } finally { Object.defineProperty(globalThis, 'document', { configurable: true, value: old }); }
});
