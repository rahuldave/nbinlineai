import type { INotebookModel } from '@jupyterlab/notebook';
import { performCellEdit } from './frontendCellEdits';

export interface FrontendAction {
  request_id: string;
  name: string;
  arguments: unknown;
}

export interface ActionResult {
  ok: boolean;
  text?: string;
  cell_id?: string;
}

function argumentsObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid action arguments.');
  return value as Record<string, unknown>;
}

function integer(value: unknown, fallback: number, min: number, max: number, name: string): number {
  const result = value === undefined ? fallback : value;
  if (typeof result !== 'number' || !Number.isInteger(result) || result < min || result > max) {
    throw new Error(`Invalid ${name}.`);
  }
  return result;
}

function sourceLines(source: string, start: number, end: number): string {
  const lines = source.split('\n');
  const selected = lines.slice(start - 1, end).map((line, index) => `${start + index}: ${line}`).join('\n');
  if (!selected) return 'No source lines in the requested range.';
  const notice = '\n[truncated; narrow the line range]';
  return selected.length > 4000 ? selected.slice(0, 4000 - notice.length) + notice : selected;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Operates on one captured notebook model; it never consults the active tab or rendered widgets. */
export class NotebookActionBridge {
  private seen = new Map<string, string>();
  private insertionTails = new Map<string, string>();

  constructor(
    private readonly model: INotebookModel,
    private readonly promptCellId: string,
    private readonly outputCellId: string
  ) {}

  /** A repeated request is ignored; changing its payload is a protocol error. */
  perform(action: FrontendAction): ActionResult | null {
    if (typeof action.request_id !== 'string' || !action.request_id || action.request_id.length > 200) {
      throw new Error('Invalid action request ID.');
    }
    const signature = canonical([action.name, action.arguments]);
    const previous = this.seen.get(action.request_id);
    if (previous !== undefined) {
      if (previous !== signature) throw new Error('Action request ID was reused with different arguments.');
      return null;
    }
    this.seen.set(action.request_id, signature);
    try {
      const args = argumentsObject(action.arguments);
      switch (action.name) {
        case 'list_cells': return { ok: true, text: this.listCells(args) };
        case 'read_cell': return { ok: true, text: this.readCell(args) };
        case 'insert_markdown': return { ok: true, cell_id: this.insertCell(args, 'markdown') };
        case 'insert_code': return { ok: true, cell_id: this.insertCell(args, 'code') };
        case 'find_cells':
        case 'replace_cell':
        case 'cell_str_replace':
        case 'cell_insert_line':
        case 'cell_replace_lines':
        case 'delete_cell':
        case 'move_cell':
        case 'copy_cell':
        case 'split_cell':
        case 'merge_cells': {
          if (this.cellIndex(this.promptCellId) < 0 || this.cellIndex(this.outputCellId) < 0) {
            throw new Error('The originating AI prompt or answer was removed.');
          }
          return { ok: true, text: performCellEdit(this.model, action.name, args).slice(0, 4000) };
        }
        default: throw new Error('Unknown notebook action.');
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Notebook action failed.';
      return { ok: false, text: text.slice(0, 500) };
    }
  }

  private cellIndex(id: string): number {
    for (let i = 0; i < this.model.cells.length; i++) {
      if (this.model.cells.get(i).id === id) return i;
    }
    return -1;
  }

  private listCells(args: Record<string, unknown>): string {
    if (Object.keys(args).some(key => key !== 'start' && key !== 'limit')) {
      throw new Error('Unsupported list_cells argument.');
    }
    const start = integer(args.start, 0, 0, 100000, 'start');
    const limit = integer(args.limit, 20, 1, 50, 'limit');
    const cells: Array<Record<string, unknown>> = [];
    for (let i = start; i < Math.min(this.model.cells.length, start + limit); i++) {
      const cell = this.model.cells.get(i);
      const ai = cell.getMetadata('nbinlineai') as Record<string, unknown> | undefined;
      const item = {
        index: i,
        cell_id: cell.id,
        cell_type: cell.type,
        source_preview: cell.sharedModel.getSource().slice(0, 160),
        ...(ai && (ai.isPromptCell || ai.isOutputCell) ? { ai: {
          is_prompt: ai.isPromptCell === true,
          is_output: ai.isOutputCell === true,
          prompt_cell_id: typeof ai.promptCellId === 'string' ? ai.promptCellId : undefined,
          status: typeof ai.status === 'string' ? ai.status : undefined
        } } : {})
      };
      if (JSON.stringify({ cells: [...cells, item] }).length > 3800) break;
      cells.push(item);
    }
    const next = start + cells.length;
    return JSON.stringify({ cells, total: this.model.cells.length,
      next_start: next < this.model.cells.length ? next : null,
      truncated: next < this.model.cells.length });
  }

  private readCell(args: Record<string, unknown>): string {
    if (Object.keys(args).some(key => key !== 'cell_id' && key !== 'start_line' && key !== 'end_line')) {
      throw new Error('Unsupported read_cell argument.');
    }
    const id = args.cell_id;
    if (typeof id !== 'string' || !id.trim() || id.length > 200) throw new Error('Invalid cell ID.');
    const start = integer(args.start_line, 1, 1, 1000000, 'start line');
    const end = integer(args.end_line, 40, start, Math.min(start + 79, 1000000), 'end line');
    const index = this.cellIndex(id);
    if (index < 0) throw new Error('Cell was removed or is not in this notebook.');
    return sourceLines(this.model.cells.get(index).sharedModel.getSource(), start, end);
  }

  private insertCell(args: Record<string, unknown>, type: 'markdown' | 'code'): string {
    // A frontend action may only insert source. It cannot smuggle an execution
    // request or notebook mutation options through this deliberately small API.
    if (Object.keys(args).some(key => key !== 'content' && key !== 'after_cell_id')) {
      throw new Error('Unsupported insertion argument.');
    }
    const content = args.content;
    if (typeof content !== 'string' || !content.trim() || content.length > 8000) {
      throw new Error(`${type === 'code' ? 'Code' : 'Markdown'} content must contain 1–8000 characters.`);
    }
    const requestedAnchor = args.after_cell_id === undefined || args.after_cell_id === '' ? this.outputCellId : args.after_cell_id;
    if (typeof requestedAnchor !== 'string' || !requestedAnchor || requestedAnchor.length > 200) throw new Error('Invalid anchor cell ID.');
    if (this.cellIndex(this.promptCellId) < 0 || this.cellIndex(this.outputCellId) < 0) {
      throw new Error('The originating AI prompt or answer was removed.');
    }
    const anchor = requestedAnchor;
    const requestedIndex = this.cellIndex(requestedAnchor);
    if (requestedIndex < 0) throw new Error('Anchor cell was removed or is not in this notebook.');
    const tail = this.insertionTails.get(anchor);
    const index = this.cellIndex(tail || anchor);
    if (index < 0) throw new Error('Insertion anchor was removed.');
    this.model.sharedModel.transact(() => {
      this.model.sharedModel.insertCell(index + 1, { cell_type: type, source: content, metadata: {} });
    });
    const inserted = this.model.cells.get(index + 1);
    if (!inserted?.id) throw new Error('Could not confirm the inserted cell.');
    this.insertionTails.set(anchor, inserted.id);
    return inserted.id;
  }
}
