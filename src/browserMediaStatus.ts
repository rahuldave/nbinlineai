/** Compact notebook-local media status and Stop controls. */
import { NotebookPanel } from '@jupyterlab/notebook';
import { Widget } from '@lumino/widgets';
import { BrowserOperationContext, BrowserOperationStatus } from './browserMediaClient';

const installed = new WeakMap<NotebookPanel, Widget>();
export function installBrowserMediaStatus(panel: NotebookPanel, context: BrowserOperationContext): void {
  installed.get(panel)?.dispose();
  const widget = new Widget();
  installed.set(panel, widget);
  widget.addClass('nbinlineai-media-status');
  widget.node.setAttribute('aria-live', 'polite');
  widget.node.hidden = true;
  const records = new Map<string, BrowserOperationStatus>();
  const render = (): void => {
    widget.node.replaceChildren();
    const values = Array.from(records.values()).slice(-5);
    widget.node.hidden = values.length === 0;
    for (const item of values) {
      const row = document.createElement('div');
      row.className = 'nbinlineai-media-status-row';
      const label = document.createElement('span');
      label.textContent = `Media ${item.status}`;
      row.append(label);
      if (['running', 'waiting_for_user', 'paused', 'saving'].includes(item.status)) {
        const stop = document.createElement('button');
        stop.type = 'button';
        stop.textContent = 'Stop';
        stop.title = 'Cancel this browser operation';
        stop.onclick = () => { void context.cancel(item.operation_id).then(next => context.emit(next)); };
        row.append(stop);
      }
      if (item.error?.message) {
        const error = document.createElement('span');
        error.textContent = item.error.message;
        row.append(error);
      }
      widget.node.append(row);
    }
  };
  const disconnect = context.onStatus(item => { records.set(item.operation_id, item); render(); });
  panel.contentHeader.addWidget(widget);
  widget.disposed.connect(() => disconnect());
  panel.disposed.connect(() => widget.dispose());
}
