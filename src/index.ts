/** JupyterLab prompt-cell shell. Execution adapters are the next milestone. */
import { JupyterFrontEnd, JupyterFrontEndPlugin } from '@jupyterlab/application';
import { ICommandPalette, ToolbarButton } from '@jupyterlab/apputils';
import { INotebookTracker, NotebookActions, NotebookPanel } from '@jupyterlab/notebook';
import { addIcon } from '@jupyterlab/ui-components';
import '../style/index.css';

const metadataKey = 'nbinlineai';
const promptClass = 'nbinlineai-prompt-cell';

function markPromptCell(panel: NotebookPanel): void {
  const notebook = panel.content;
  NotebookActions.insertBelow(notebook);
  const cell = notebook.activeCell;
  if (!cell) return;
  NotebookActions.changeCellType(notebook, 'markdown');
  const promptCell = notebook.activeCell;
  if (!promptCell) return;
  promptCell.model.setMetadata(metadataKey, { isPromptCell: true });
  promptCell.model.sharedModel.setSource('**AI Prompt:** ');
  promptCell.addClass(promptClass);
  notebook.mode = 'edit';
}

function restorePromptStyles(panel: NotebookPanel): void {
  const notebook = panel.content;
  for (const cell of notebook.widgets) {
    const meta = cell.model.getMetadata(metadataKey) as { isPromptCell?: boolean } | undefined;
    if (meta?.isPromptCell) cell.addClass(promptClass);
    else cell.removeClass(promptClass);
  }
}

const plugin: JupyterFrontEndPlugin<void> = {
  id: 'nbinlineai:plugin',
  autoStart: true,
  requires: [INotebookTracker],
  optional: [ICommandPalette],
  activate: (app: JupyterFrontEnd, tracker: INotebookTracker, palette: ICommandPalette | null) => {
    const command = 'nbinlineai:insert-prompt-cell';
    app.commands.addCommand(command, {
      label: 'Insert AI Prompt Cell',
      execute: () => {
        const panel = tracker.currentWidget;
        if (panel) markPromptCell(panel);
      }
    });
    palette?.addItem({ command, category: 'AI' });

    const setup = (panel: NotebookPanel) => {
      const onReady = () => {
        if (panel.isDisposed) return;
        panel.toolbar.insertAfter('cellType', 'nbinlineai-insert', new ToolbarButton({
          icon: addIcon,
          label: 'AI Prompt',
          tooltip: 'Insert AI Prompt Cell',
          onClick: () => markPromptCell(panel)
        }));
        restorePromptStyles(panel);
        panel.content.activeCellChanged.connect(() => restorePromptStyles(panel));
      };
      void panel.context.ready.then(onReady);
    };
    tracker.widgetAdded.connect((_, panel) => setup(panel));
    tracker.forEach(setup);
  }
};

export default plugin;
