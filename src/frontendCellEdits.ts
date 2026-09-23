import type { INotebookModel } from '@jupyterlab/notebook';
import type { ISharedAttachmentsCell, ISharedCodeCell } from '@jupyter/ydoc';

type Args = Record<string, unknown>;
const MAX_SOURCE = 8000;
const MAX_SEARCH_CELLS = 2000;
const MAX_SEARCH_CHARS = 2_000_000;

function combineFields<T>(first: Record<string, T>, second: Record<string, T>, label: string): Record<string, T> {
  const combined = { ...first };
  for (const [key, value] of Object.entries(second)) {
    if (key in combined && JSON.stringify(combined[key]) !== JSON.stringify(value)) {
      throw new Error(`Cells have conflicting ${label}: ${key}.`);
    }
    combined[key] = value;
  }
  return combined;
}

function only(args: Args, required: string[], optional: string[] = []): void {
  if (Object.keys(args).some(key => !required.includes(key) && !optional.includes(key)) ||
      required.some(key => !(key in args))) throw new Error('Unexpected or missing notebook edit argument.');
}

function string(args: Args, key: string, max = MAX_SOURCE, empty = false): string {
  const value = args[key];
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) {
    throw new Error(`Invalid ${key}.`);
  }
  return value;
}

function number(args: Args, key: string, fallback: number, min: number, max: number): number {
  const value = args[key] === undefined ? fallback : args[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Invalid ${key}.`);
  }
  return value;
}

/** Edits only the captured live notebook model. All checks precede each transaction. */
export function performCellEdit(model: INotebookModel, name: string, args: Args): string {
  const cells = model.cells;
  const locate = (id: string): number => {
    for (let i = 0; i < cells.length; i++) if (cells.get(i).id === id) return i;
    throw new Error('Cell was removed or is not in this notebook.');
  };
  const ordinary = (index: number) => {
    const cell = cells.get(index);
    const ai = cell.getMetadata('nbinlineai') as Record<string, unknown> | undefined;
    if (ai && (ai.isPromptCell === true || ai.isOutputCell === true)) {
      throw new Error('AI question and answer cells are protected.');
    }
    return cell;
  };
  const checked = (index: number, expected: string) => {
    const cell = ordinary(index);
    if (cell.sharedModel.getSource() !== expected) throw new Error('Cell source changed; read it again before editing.');
    return cell;
  };
  const clearCode = (index: number) => {
    const cell = cells.get(index);
    if (cell.type === 'code') {
      const shared = cell.sharedModel as ISharedCodeCell;
      shared.setOutputs([]);
      shared.execution_count = null;
    }
  };
  const update = (index: number, source: string) => {
    if (source.length > MAX_SOURCE) throw new Error('New cell source exceeds 8000 characters.');
    model.sharedModel.transact(() => {
      cells.get(index).sharedModel.setSource(source);
      clearCode(index);
    });
    return `Updated cell ${cells.get(index).id} in the live notebook model (not saved to disk).`;
  };
  const id = () => string(args, 'cell_id', 200);
  const anchor = () => {
    const anchorIndex = locate(string(args, 'after_cell_id', 200));
    const ai = cells.get(anchorIndex).getMetadata('nbinlineai') as Record<string, unknown> | undefined;
    if (ai?.isPromptCell === true) throw new Error('Cannot place a cell between an AI question and answer.');
    return anchorIndex;
  };

  if (name === 'find_cells') {
    only(args, ['query'], ['cell_type', 'limit']);
    const query = string(args, 'query', 200).toLowerCase();
    const type = args.cell_type === undefined ? '' : string(args, 'cell_type', 10, true);
    if (!['', 'code', 'markdown', 'raw'].includes(type)) throw new Error('Invalid cell_type.');
    const limit = number(args, 'limit', 20, 1, 50);
    const matches: Array<{ index: number; cell_id: string; cell_type: string; source_preview: string }> = [];
    let total = 0;
    let inspectedChars = 0;
    let scannedCells = 0;
    let partial = false;
    for (let i = 0; i < Math.min(cells.length, MAX_SEARCH_CELLS); i++) {
      const cell = cells.get(i);
      const source = cell.sharedModel.getSource();
      const remaining = MAX_SEARCH_CHARS - inspectedChars;
      if (remaining <= 0) {
        partial = true;
        break;
      }
      const excerpt = source.slice(0, remaining);
      inspectedChars += excerpt.length;
      scannedCells++;
      if (excerpt.length < source.length) partial = true;
      if ((!type || cell.type === type) && excerpt.toLowerCase().includes(query)) {
        total++;
        const item = { index: i, cell_id: cell.id, cell_type: cell.type, source_preview: source.slice(0, 120) };
        if (matches.length < limit && JSON.stringify({ matches: [...matches, item], total }).length < 3800) matches.push(item);
      }
      if (partial) break;
    }
    if (scannedCells < cells.length) partial = true;
    return JSON.stringify({ matches, total: partial ? null : total,
      scanned_cells: scannedCells, partial, truncated: partial || total > matches.length });
  }
  if (name === 'replace_cell') {
    only(args, ['cell_id', 'expected_source', 'new_source']);
    const index = locate(id());
    checked(index, string(args, 'expected_source', MAX_SOURCE, true));
    return update(index, string(args, 'new_source', MAX_SOURCE, true));
  }
  if (name === 'cell_str_replace') {
    only(args, ['cell_id', 'old_str', 'new_str'], ['expected_matches']);
    const index = locate(id());
    const source = ordinary(index).sharedModel.getSource();
    const oldText = string(args, 'old_str');
    const newText = string(args, 'new_str', MAX_SOURCE, true);
    const matches = number(args, 'expected_matches', 1, 1, 1000);
    if (source.split(oldText).length - 1 !== matches) throw new Error('Cell match count changed; read it again before editing.');
    return update(index, source.split(oldText).join(newText));
  }
  if (name === 'cell_insert_line' || name === 'cell_replace_lines') {
    only(args, name === 'cell_insert_line'
      ? ['cell_id', 'line', 'content', 'expected_source']
      : ['cell_id', 'start_line', 'end_line', 'content', 'expected_source']);
    const index = locate(id());
    const source = string(args, 'expected_source', MAX_SOURCE, true);
    checked(index, source);
    const lines = source.split('\n');
    const content = string(args, 'content', MAX_SOURCE, true).split('\n');
    if (name === 'cell_insert_line') {
      const line = number(args, 'line', 0, 1, lines.length + 1);
      lines.splice(line - 1, 0, ...content);
    } else {
      const start = number(args, 'start_line', 0, 1, lines.length);
      const end = number(args, 'end_line', 0, start, lines.length);
      lines.splice(start - 1, end - start + 1, ...content);
    }
    return update(index, lines.join('\n'));
  }
  if (name === 'delete_cell') {
    only(args, ['cell_id', 'expected_source']);
    const index = locate(id());
    checked(index, string(args, 'expected_source', MAX_SOURCE, true));
    model.sharedModel.transact(() => model.sharedModel.deleteCell(index));
    return `Deleted cell ${args.cell_id} from the live notebook model (not saved to disk).`;
  }
  if (name === 'move_cell' || name === 'copy_cell') {
    only(args, ['cell_id', 'after_cell_id']);
    const sourceIndex = locate(id());
    const cell = ordinary(sourceIndex);
    const sourceId = cell.id;
    const anchorIndex = anchor();
    if (name === 'move_cell') {
      if (sourceIndex === anchorIndex) throw new Error('Cell cannot move after itself.');
      const destination = sourceIndex < anchorIndex ? anchorIndex : anchorIndex + 1;
      model.sharedModel.transact(() => model.sharedModel.moveCell(sourceIndex, destination));
      return `Moved cell ${sourceId} in the live notebook model (not saved to disk).`;
    }
    const copy = cell.sharedModel.toJSON();
    const data = { cell_type: cell.type, source: cell.sharedModel.getSource(), metadata: copy.metadata,
      ...(cell.type !== 'code' ? { attachments: (cell.sharedModel as ISharedAttachmentsCell).getAttachments() } : {}) };
    model.sharedModel.transact(() => model.sharedModel.insertCell(anchorIndex + 1, data));
    const inserted = cells.get(anchorIndex + 1);
    return `Copied cell as ${inserted.id} in the live notebook model (not saved to disk).`;
  }
  if (name === 'split_cell') {
    only(args, ['cell_id', 'line', 'expected_source']);
    const index = locate(id());
    const source = string(args, 'expected_source', MAX_SOURCE, true);
    const cell = checked(index, source);
    const lines = source.split('\n');
    const line = number(args, 'line', 0, 2, lines.length);
    const left = lines.slice(0, line - 1).join('\n');
    const right = lines.slice(line - 1).join('\n');
    const metadata = cell.sharedModel.toJSON().metadata;
    const attachments = cell.type !== 'code' ? (cell.sharedModel as ISharedAttachmentsCell).getAttachments() : undefined;
    model.sharedModel.transact(() => {
      cell.sharedModel.setSource(left);
      clearCode(index);
      model.sharedModel.insertCell(index + 1, { cell_type: cell.type, source: right, metadata,
        ...(cell.type !== 'code' ? { attachments } : {}) });
    });
    return `Split cell ${cell.id}; new cell ${cells.get(index + 1).id} is in the live notebook model (not saved to disk).`;
  }
  if (name === 'merge_cells') {
    only(args, ['first_cell_id', 'second_cell_id', 'expected_first', 'expected_second']);
    const first = locate(string(args, 'first_cell_id', 200));
    const second = locate(string(args, 'second_cell_id', 200));
    if (second !== first + 1) throw new Error('Cells must be adjacent and in the requested order.');
    const firstCell = checked(first, string(args, 'expected_first', MAX_SOURCE, true));
    const secondCell = checked(second, string(args, 'expected_second', MAX_SOURCE, true));
    if (firstCell.type !== secondCell.type) throw new Error('Cells must have the same type.');
    const firstMetadata = firstCell.sharedModel.toJSON().metadata as Record<string, unknown>;
    const secondMetadata = secondCell.sharedModel.toJSON().metadata as Record<string, unknown>;
    const mergedMetadata = combineFields(firstMetadata, secondMetadata, 'metadata');
    const firstAttachments = firstCell.type !== 'code'
      ? (firstCell.sharedModel as ISharedAttachmentsCell).getAttachments() : undefined;
    const secondAttachments = secondCell.type !== 'code'
      ? (secondCell.sharedModel as ISharedAttachmentsCell).getAttachments() : undefined;
    const mergedAttachments = combineFields(firstAttachments || {}, secondAttachments || {}, 'attachments');
    const combined = `${firstCell.sharedModel.getSource()}\n${secondCell.sharedModel.getSource()}`;
    if (combined.length > MAX_SOURCE) throw new Error('Merged cell source exceeds 8000 characters.');
    model.sharedModel.transact(() => {
      firstCell.sharedModel.setSource(combined);
      for (const [key, value] of Object.entries(mergedMetadata)) {
        firstCell.sharedModel.setMetadata(key, value as never);
      }
      if (firstCell.type !== 'code') {
        (firstCell.sharedModel as ISharedAttachmentsCell).setAttachments(mergedAttachments);
      }
      clearCode(first);
      model.sharedModel.deleteCell(second);
    });
    return `Merged cells into ${firstCell.id} in the live notebook model (not saved to disk).`;
  }
  throw new Error('Unknown notebook edit action.');
}
