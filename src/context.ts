import { INotebookModel } from '@jupyterlab/notebook';

export interface PrecedingCell {
  id: string;
  cell_type: string;
  source: string;
  metadata?: Record<string, unknown>;
  execution_count?: number | null;
}

/** Read notebook models, never rendered widgets, so windowed notebooks work. */
export function precedingCells(model: INotebookModel, promptCellId: string): PrecedingCell[] {
  const result: PrecedingCell[] = [];
  for (let index = 0; index < model.cells.length; index++) {
    const cell = model.cells.get(index);
    if (cell.id === promptCellId) return result;
    const json = cell.toJSON();
    const entry: PrecedingCell = {
      id: cell.id,
      cell_type: cell.type,
      source: cell.sharedModel.getSource(),
      metadata: json.metadata as Record<string, unknown>
    };
    if (cell.type === 'code') entry.execution_count = json.cell_type === 'code' && typeof json.execution_count === 'number' ? json.execution_count : null;
    result.push(entry);
  }
  throw new Error('Prompt cell was removed before context collection.');
}
