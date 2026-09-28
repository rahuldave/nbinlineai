/** Read-only observations of the notebook that owns a browser operation. */
import { BrowserMediaError, BrowserOperationContext, registerBrowserOperation } from './browserMediaClient';

function visibleIds(context: BrowserOperationContext): { first: string | null; last: string | null; count: number } {
  const notebook = context.panel.content;
  const boundary = notebook.node.getBoundingClientRect();
  const ids: string[] = [];
  for (const widget of notebook.widgets) {
    if (widget.isDisposed || widget.isPlaceholder() || !widget.node.isConnected) continue;
    const bounds = widget.node.getBoundingClientRect();
    if (bounds.width > 0 && bounds.height > 0 && bounds.bottom > boundary.top &&
        bounds.top < boundary.bottom && bounds.right > boundary.left && bounds.left < boundary.right)
      ids.push(widget.model.id);
  }
  return { first: ids[0] ?? null, last: ids.length ? ids[ids.length - 1] : null, count: ids.length };
}
export function readNotebookView(context: BrowserOperationContext): Record<string, unknown> {
  if (!context.isCurrent()) throw new BrowserMediaError('stale_target', 'The originating notebook changed.');
  const notebook = context.panel.content;
  const selected = notebook.selectedCells.slice(0, 12).map(widget => widget.model.id.slice(0, 200));
  return { active_cell_id: notebook.activeCell?.model.id ?? null,
    active_cell_index: notebook.activeCellIndex, selected_cell_ids: selected,
    selected_truncated: notebook.selectedCells.length > selected.length,
    visible: visibleIds(context), mode: notebook.mode,
    cell_count: notebook.model?.cells.length ?? 0 };
}
export function readSelection(context: BrowserOperationContext, maxChars: number): Record<string, unknown> {
  if (!context.isCurrent()) throw new BrowserMediaError('stale_target', 'The originating notebook changed.');
  if (!Number.isInteger(maxChars) || maxChars < 1 || maxChars > 3000)
    throw new BrowserMediaError('invalid_argument', 'max_chars must be 1 to 3000.');
  const notebook = context.panel.content;
  if (notebook.mode !== 'edit' || document.activeElement === null ||
      !context.panel.node.contains(document.activeElement)) return { cell_id: null, text: '', truncated: false };
  const widget = notebook.activeCell;
  const editor = widget?.editor;
  if (!widget || widget.isPlaceholder() || !editor?.hasFocus())
    return { cell_id: null, text: '', truncated: false };
  const selection = editor.getSelection();
  const start = editor.getOffsetAt(selection.start);
  const end = editor.getOffsetAt(selection.end);
  const source = widget.model.sharedModel.getSource();
  const value = source.slice(Math.min(start, end), Math.max(start, end));
  let length = Math.min(maxChars, value.length);
  const result = (size: number): Record<string, unknown> => ({ cell_id: widget.model.id,
    text: value.slice(0, size), truncated: value.length > size, total_chars: value.length });
  while (length > 0 && JSON.stringify(result(length)).length > 3200) length = Math.floor(length * 0.75);
  return result(length);
}
let viewOperationsRegistered = false;
export function registerBrowserNotebookViews(): void {
if (viewOperationsRegistered) return;
viewOperationsRegistered = true;
registerBrowserOperation('read_notebook_view', async (context, _request, operation) => {
  await context.transition(operation.operation_id, 'completed', readNotebookView(context));
}, () => ({ available: true }));
registerBrowserOperation('read_selection', async (context, request, operation) => {
  const requested = request.arguments.max_chars ?? 2000;
  if (typeof requested !== 'number') throw new BrowserMediaError('invalid_argument', 'max_chars must be an integer.');
  await context.transition(operation.operation_id, 'completed', readSelection(context, requested));
}, () => ({ available: true }));
}
