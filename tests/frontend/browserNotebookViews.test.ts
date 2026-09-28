import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readNotebookView, readSelection } from '../../src/browserNotebookViews';

test('view and selection stay within originating notebook and only observe state', () => {
  const source = 'alpha beta gamma';
  const cell = { model: { id: 'cell-1', sharedModel: { getSource: () => source } },
    isDisposed: false, isPlaceholder: () => false, node: {
      isConnected: true, getBoundingClientRect: () => ({ left: 0, right: 100, top: 10, bottom: 40,
        width: 100, height: 30 }) },
    editor: { hasFocus: () => true, getSelection: () => ({ start: {}, end: {} }),
      getOffsetAt: (_: unknown) => offset++ ? 10 : 6 } };
  let offset = 0;
  const notebook = { node: { getBoundingClientRect: () => ({ left: 0, right: 200,
      top: 0, bottom: 100 }), }, widgets: [cell], selectedCells: [cell], activeCell: cell,
    activeCellIndex: 0, mode: 'edit', model: { cells: { length: 1 } } };
  const panel = { content: notebook, node: { contains: (value: unknown) => value === 'inside' } };
  const context = { isCurrent: () => true, panel };
  const oldDocument = globalThis.document;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { activeElement: 'inside' } });
  try {
    const view = readNotebookView(context as never);
    assert.deepEqual(view.visible, { first: 'cell-1', last: 'cell-1', count: 1 });
    assert.deepEqual(view.selected_cell_ids, ['cell-1']);
    assert.equal(readSelection(context as never, 3).text, 'bet');
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { activeElement: 'another-tab' } });
    assert.deepEqual(readSelection(context as never, 3), { cell_id: null, text: '', truncated: false });
  } finally { Object.defineProperty(globalThis, 'document', { configurable: true, value: oldDocument }); }
});
