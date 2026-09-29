/** Compact notebook-local media status and Stop controls. */
import { NotebookPanel } from '@jupyterlab/notebook';
import { Widget } from '@lumino/widgets';
import { BrowserOperationContext, BrowserOperationStatus } from './browserMediaClient';
import { BrowserMediaStatusModel } from './browserMediaStatusModel';

const installed = new WeakMap<NotebookPanel, Widget>();
export function installBrowserMediaStatus(panel: NotebookPanel, context: BrowserOperationContext): void {
  installed.get(panel)?.dispose();
  const widget = new Widget();
  installed.set(panel, widget);
  widget.addClass('nbinlineai-media-status');
  widget.node.setAttribute('aria-live', 'polite');
  widget.node.hidden = true;
  let model: BrowserMediaStatusModel;
  const render = (records: BrowserOperationStatus[]): void => {
    widget.node.replaceChildren();
    widget.node.hidden = records.length === 0;
    for (const item of records) {
      const row = document.createElement('div');
      row.className = 'nbinlineai-media-status-row';
      const label = document.createElement('span');
      label.textContent = item.status === 'paused' && item.result?.source_id ?
        'Media paused (source preview remains live)' : `Media ${item.status}`;
      row.append(label);
      if (['running', 'waiting_for_user', 'paused', 'saving'].includes(item.status)) {
        const stop = document.createElement('button');
        stop.type = 'button';
        stop.textContent = 'Stop';
        stop.title = 'Cancel this browser operation';
        stop.onclick = () => { void model.stop(item.operation_id); };
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
  model = new BrowserMediaStatusModel(context, render);
  panel.contentHeader.addWidget(widget);
  widget.disposed.connect(() => model.dispose());
  panel.disposed.connect(() => widget.dispose());
}
