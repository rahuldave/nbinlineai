import { INotebookModel } from '@jupyterlab/notebook';

export type ContextMode = 'default' | 'full-notebook' | 'all-above' | 'ten-above' | 'ten-above-below' | 'custom' | 'current-only';
export const contextModes: ReadonlyArray<[ContextMode, string]> = [
  ['default', 'Default'], ['full-notebook', 'Full notebook'], ['all-above', 'All above'],
  ['ten-above', '10 above'], ['ten-above-below', '10 above + below'], ['custom', 'Custom'],
  ['current-only', 'Current question only']
];
export function contextMode(value: unknown): ContextMode {
  return contextModes.find(([mode]) => mode === value)?.[0] || 'default';
}
export interface NotebookCellSnapshot {
  id: string;
  cell_type: string;
  source: string;
  metadata?: Record<string, unknown>;
  execution_count?: number | null;
  context_include?: boolean;
  tools_include?: boolean;
}
export type PrecedingCell = NotebookCellSnapshot;

/** Read notebook models, never rendered widgets, so windowed notebooks work. */
export function notebookCells(model: INotebookModel, promptCellId: string): NotebookCellSnapshot[] {
  const result: NotebookCellSnapshot[] = [];
  let found = false;
  for (let index = 0; index < model.cells.length; index++) {
    const cell = model.cells.get(index);
    if (cell.id === promptCellId) found = true;
    const json = cell.toJSON();
    const metadata = json.metadata as Record<string, unknown>;
    const ai = metadata?.nbinlineai as Record<string, unknown> | undefined;
    const entry: NotebookCellSnapshot = {
      id: cell.id,
      cell_type: cell.type,
      source: cell.sharedModel.getSource(),
      metadata
    };
    if (cell.type === 'code') entry.execution_count = json.cell_type === 'code' && typeof json.execution_count === 'number' ? json.execution_count : null;
    if (typeof ai?.contextInclude === 'boolean') entry.context_include = ai.contextInclude;
    if (typeof ai?.toolsInclude === 'boolean') entry.tools_include = ai.toolsInclude;
    result.push(entry);
  }
  if (!found) throw new Error('Prompt cell was removed before context collection.');
  return result;
}

/** Legacy preceding-only shape remains available for older callers. */
export function precedingCells(model: INotebookModel, promptCellId: string): PrecedingCell[] {
  const cells = notebookCells(model, promptCellId);
  return cells.slice(0, cells.findIndex(cell => cell.id === promptCellId));
}

export function linkedToCurrent(cell: NotebookCellSnapshot, promptId: string): boolean {
  const ai = cell.metadata?.nbinlineai as Record<string, unknown> | undefined;
  return cell.id === promptId || aiRole(cell) === 'response' && (ai?.promptCellId || ai?.prompt_cell_id) === promptId;
}
export function aiRole(cell: NotebookCellSnapshot): 'prompt' | 'response' | null {
  const ai = cell.metadata?.nbinlineai as Record<string, unknown> | undefined;
  if (ai?.isOutputCell || ai?.is_output_cell || ai?.role === 'response') return 'response';
  if (ai?.isPromptCell || ai?.is_prompt_cell || ai?.role === 'prompt') return 'prompt';
  return null;
}
export function locallyEligible(cell: NotebookCellSnapshot, promptId: string): boolean {
  if (linkedToCurrent(cell, promptId) || cell.cell_type === 'raw' || !cell.source.trim()) return false;
  const ai = cell.metadata?.nbinlineai as Record<string, unknown> | undefined;
  if (aiRole(cell) !== 'response') return true;
  return (ai?.status === undefined || ai.status === 'done') && typeof (ai?.promptCellId || ai?.prompt_cell_id) === 'string';
}
/** Default retains the 0.1.7 truthy-source rule; explicit modes trim whitespace. */
export function emptySourceForMode(source: string, mode: ContextMode): boolean {
  return mode === 'default' ? source.length === 0 : source.trim().length === 0;
}

/** Physical windows count raw, empty and other ineligible cells. */
export function modeCandidateIds(cells: readonly NotebookCellSnapshot[], promptId: string, mode: ContextMode): Set<string> {
  const index = cells.findIndex(cell => cell.id === promptId);
  if (index < 0) return new Set();
  const before = cells.slice(0, index).filter(cell => !linkedToCurrent(cell, promptId));
  const after = cells.slice(index + 1).filter(cell => !linkedToCurrent(cell, promptId));
  const chosen = mode === 'full-notebook' || mode === 'custom' ? [...before, ...after]
    : mode === 'current-only' ? []
    : mode === 'ten-above' ? before.slice(-10)
    : mode === 'ten-above-below' ? [...before.slice(-10), ...after.slice(0, 10)]
    : before;
  const prompts = new Set(cells.filter(cell => aiRole(cell) === 'prompt').map(cell => cell.id));
  return new Set(chosen.filter(cell => {
    const ai = cell.metadata?.nbinlineai as Record<string, unknown> | undefined;
    const link = ai?.promptCellId || ai?.prompt_cell_id;
    return locallyEligible(cell, promptId) && (aiRole(cell) !== 'response' || prompts.has(String(link))) &&
      (mode !== 'custom' || cell.context_include !== false);
  }).map(cell => cell.id));
}

/** Prepare one transaction's Custom metadata without disturbing other fields. */
export function customSeed(cells: readonly NotebookCellSnapshot[], selected: ReadonlySet<string>, click?: { id: string; checked: boolean }): Array<{ id: string; ai: Record<string, unknown> }> {
  return cells.map(cell => {
    const prior = (cell.metadata?.nbinlineai as Record<string, unknown> | undefined) || {};
    return { id: cell.id, ai: { ...prior, contextInclude: click?.id === cell.id ? click.checked : selected.has(cell.id) } };
  });
}

/** This key changes whenever a first-round preview would need fresh input. */
export function contextRevisionKey(cells: readonly NotebookCellSnapshot[], targetId: string | null,
  mode: ContextMode, sessionId: string | undefined, kernelId: string | undefined, settings: unknown): string {
  return JSON.stringify([targetId, mode, sessionId, kernelId, settings, cells.map(cell =>
    [cell.id, cell.cell_type, cell.source, cell.execution_count, cell.metadata, cell.context_include, cell.tools_include])]);
}

/** The server recognizes literal &`name` declarations in Markdown source. */
export function toolDeclarationNames(cell: NotebookCellSnapshot): string[] {
  if (cell.cell_type !== 'markdown' || aiRole(cell) === 'response') return [];
  const found = new Set<string>();
  for (const match of cell.source.matchAll(/&`([A-Za-z_][A-Za-z0-9_]*)`/g)) found.add(match[1]);
  return [...found];
}

export function toolChoiceMetadata(existing: Record<string, unknown>, checked: boolean): Record<string, unknown> {
  return { ...existing, toolsInclude: checked };
}

/** Mirror the server's bounded JSON snapshot transport before creating an answer. */
export function snapshotTransportError(cells: readonly NotebookCellSnapshot[]): string | null {
  if (cells.length > 10000) return 'This notebook has more than 10,000 cells; the AI context snapshot cannot be sent.';
  const json = JSON.stringify(cells);
  let chars = json.length;
  let quoted = false;
  let escaped = false;
  for (const char of json) {
    if (escaped) { escaped = false; continue; }
    if (quoted && char === '\\') { escaped = true; continue; }
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === ',' || char === ':')) chars++;
  }
  return chars > 4_000_000 ? 'The notebook context snapshot exceeds the 4,000,000-character request limit.' : null;
}
