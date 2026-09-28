/** Passive, model-bound access to existing outputs, including offscreen/unsaved cells. */
import type { ICodeCellModel } from '@jupyterlab/cells';
import type { IOutputModel } from '@jupyterlab/rendermime';
import { BrowserMediaError, BrowserOperationContext,
  BrowserOperationStatus, registerBrowserOperation } from './browserMediaClient';

export interface OutputRef {
  cell_id: string;
  output_id: string;
  revision: number;
  mime_types: string[];
  output_type: string;
}
interface Entry { cellId: string; model: IOutputModel; id: string; revision: number; onChanged: () => void; }
interface CellWatch { model: ICodeCellModel; generation: number; onChanged: () => void; }

function fail(code: string, message: string): never { throw new BrowserMediaError(code, message); }
function id(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
}
function integer(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max)
    fail('invalid_argument', `${label} must be an integer from ${min} to ${max}.`);
  return value;
}
function string(value: unknown, label: string, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim()))
    fail('invalid_argument', `${label} must be bounded text.`);
  return value;
}
function cell(context: BrowserOperationContext, cellId: string): ICodeCellModel {
  if (!context.isCurrent()) fail('stale_target', 'The originating notebook changed.');
  const cells = context.panel.content.model?.cells;
  if (!cells) fail('stale_target', 'The originating notebook is unavailable.');
  for (let i = 0; i < cells.length; i++) {
    const model = cells.get(i);
    if (model.id === cellId) {
      if (model.type !== 'code') fail('unsupported', 'Only code cells have existing outputs.');
      return model as ICodeCellModel;
    }
  }
  return fail('stale_target', 'The output cell was removed from this notebook.');
}
function choices(output: IOutputModel): string[] {
  if (output.type === 'stream' || output.type === 'error') return ['text/plain'];
  return Object.keys(output.data).filter(mime => mime.length <= 60).slice(0, 8);
}
function describe(entry: Entry): OutputRef {
  return { cell_id: entry.cellId, output_id: entry.id, revision: entry.revision,
    mime_types: choices(entry.model), output_type: entry.model.type };
}

/** One ledger per originating owner. Never use an output index as identity. */
export class OutputLedger {
  private readonly byModel = new WeakMap<IOutputModel, Entry>();
  private readonly byId = new Map<string, Entry>();
  private readonly watched = new Map<string, CellWatch>();
  private readonly listeners = new Set<(entry: Entry) => void>();
  private readonly onCellsChanged = (): void => {
    const cells = this.context.panel.content.model?.cells;
    for (const [id, watch] of this.watched) {
      let current = false;
      if (cells) for (let i = 0; i < cells.length; i++)
        if (cells.get(i) === watch.model && cells.get(i).id === id) { current = true; break; }
      if (!current) {
        watch.model.outputs.changed.disconnect(watch.onChanged);
        this.watched.delete(id);
        for (const entry of Array.from(this.byId.values())) if (entry.cellId === id) this.drop(entry);
      }
    }
  };
  constructor(readonly context: BrowserOperationContext) {
    context.panel.content.model?.cells.changed.connect(this.onCellsChanged);
    context.addCleanup(() => this.dispose());
  }
  onInvalidated(listener: (ref: OutputRef) => void): () => void {
    const wrapped = (entry: Entry): void => listener(describe(entry));
    this.listeners.add(wrapped);
    return () => this.listeners.delete(wrapped);
  }
  private invalidated(entry: Entry): void { this.listeners.forEach(listener => listener(entry)); }
  private drop(entry: Entry): void {
    if (!this.byId.has(entry.id)) return;
    entry.model.changed.disconnect(entry.onChanged);
    entry.model.streamText?.changed.disconnect(entry.onChanged);
    this.byId.delete(entry.id);
    this.invalidated(entry);
  }
  private reconcile(cellId: string, model: ICodeCellModel): void {
    const live = new Set<IOutputModel>();
    for (let i = 0; i < model.outputs.length; i++) live.add(model.outputs.get(i));
    for (const entry of this.byId.values()) if (entry.cellId === cellId && !live.has(entry.model)) this.drop(entry);
  }
  private watch(cellId: string, model: ICodeCellModel): CellWatch {
    const existing = this.watched.get(cellId);
    if (existing?.model === model) return existing;
    if (existing) {
      existing.model.outputs.changed.disconnect(existing.onChanged);
      for (const entry of this.byId.values()) if (entry.cellId === cellId) this.drop(entry);
    }
    const watched: CellWatch = { model, generation: 0, onChanged: () => {
      watched.generation++;
      this.reconcile(cellId, model);
    } };
    model.outputs.changed.connect(watched.onChanged);
    this.watched.set(cellId, watched);
    return watched;
  }
  private entry(cellId: string, model: IOutputModel): Entry {
    let entry = this.byModel.get(model);
    if (entry && this.byId.has(entry.id)) return entry;
    entry = { cellId, model, id: id(), revision: 0, onChanged: () => {
      entry!.revision++;
      this.invalidated(entry!);
    } };
    this.byModel.set(model, entry);
    this.byId.set(entry.id, entry);
    model.changed.connect(entry.onChanged);
    model.streamText?.changed.connect(entry.onChanged);
    return entry;
  }
  list(cellId: string, cursor: string, limit: number): { outputs: OutputRef[]; next_cursor: string | null } {
    const model = cell(this.context, cellId);
    const watched = this.watch(cellId, model);
    this.reconcile(cellId, model);
    const match = cursor ? /^(\d+):(\d+)$/.exec(cursor) : null;
    if (cursor && (!match || Number(match[1]) !== watched.generation))
      fail('stale_target', 'Output list changed; restart from the first page.');
    const offset = match ? integer(Number(match[2]), 'cursor', 0, 1_000_000) : 0;
    const outputs: OutputRef[] = [];
    for (let i = offset; i < Math.min(model.outputs.length, offset + limit); i++) {
      const candidate = describe(this.entry(cellId, model.outputs.get(i)));
      if (outputs.length && JSON.stringify({ outputs: [...outputs, candidate] }).length > 3000) break;
      outputs.push(candidate);
    }
    const next = offset + outputs.length;
    return { outputs, next_cursor: next < model.outputs.length ? `${watched.generation}:${next}` : null };
  }
  resolve(cellId: string, outputId: string, revision: number): { model: IOutputModel; index: number; ref: OutputRef } {
    const outputCell = cell(this.context, cellId);
    this.watch(cellId, outputCell);
    this.reconcile(cellId, outputCell);
    const entry = this.byId.get(outputId);
    if (!entry || entry.cellId !== cellId || entry.revision !== revision)
      fail('stale_target', 'Output reference changed or expired; list outputs again.');
    for (let i = 0; i < outputCell.outputs.length; i++)
      if (outputCell.outputs.get(i) === entry.model) return { model: entry.model, index: i, ref: describe(entry) };
    return fail('stale_target', 'Output was removed.');
  }
  dispose(): void {
    this.context.panel.content.model?.cells.changed.disconnect(this.onCellsChanged);
    for (const watch of this.watched.values()) watch.model.outputs.changed.disconnect(watch.onChanged);
    for (const entry of Array.from(this.byId.values())) this.drop(entry);
    this.watched.clear(); this.listeners.clear();
  }
}
const ledgers = new WeakMap<BrowserOperationContext, OutputLedger>();
export function outputLedger(context: BrowserOperationContext): OutputLedger {
  let ledger = ledgers.get(context);
  if (!ledger) { ledger = new OutputLedger(context); ledgers.set(context, ledger); }
  return ledger;
}
function requiredRef(arguments_: Record<string, unknown>): { cellId: string; outputId: string; revision: number } {
  return { cellId: string(arguments_.cell_id, 'cell_id', 200),
    outputId: string(arguments_.output_id, 'output_id', 100),
    revision: integer(arguments_.revision, 'revision', 0, 1_000_000_000) };
}
function plainText(output: IOutputModel, mime: string): string {
  if (mime === 'text/plain' && output.streamText) return output.streamText.text;
  if (mime === 'text/plain' && output.type === 'error') {
    const record = output.toJSON() as { traceback?: string[] };
    return (record.traceback ?? []).join('\n');
  }
  if (!['text/plain', 'text/markdown', 'application/json', 'application/vnd.dataresource+json'].includes(mime))
    fail('unsupported', 'This MIME cannot be returned as bounded output text.');
  const data = output.data[mime];
  if (data === undefined) fail('unsupported', 'The selected MIME is absent.');
  return typeof data === 'string' ? data : Array.isArray(data) && data.every(item => typeof item === 'string')
    ? data.join('') : JSON.stringify(data);
}
export function readOutput(ledger: OutputLedger, arguments_: Record<string, unknown>): Record<string, unknown> {
  const { cellId, outputId, revision } = requiredRef(arguments_);
  const mime = string(arguments_.mime ?? 'text/plain', 'mime', 100);
  const output = ledger.resolve(cellId, outputId, revision).model;
  const start = integer(arguments_.start ?? 0, 'start', 0, 1_000_000);
  const max = integer(arguments_.max_chars ?? 2000, 'max_chars', 1, 3000);
  const value = plainText(output, mime);
  let length = Math.min(max, Math.max(0, value.length - start));
  const result = (size: number): Record<string, unknown> => ({ cell_id: cellId,
    output_id: outputId, revision, mime, text: value.slice(start, start + size), start,
    next_start: start + size < value.length ? start + size : null, total_chars: value.length });
  while (length > 0 && JSON.stringify(result(length)).length > 3200) length = Math.floor(length * 0.75);
  return result(length);
}
function encoded(output: IOutputModel, mime: string): Uint8Array {
  const data = output.data[mime];
  if (typeof data !== 'string' && !(Array.isArray(data) && data.every(part => typeof part === 'string')))
    fail('unsupported', 'The existing output has no supported native bytes for that MIME.');
  const raw = typeof data === 'string' ? data : (data as string[]).join('');
  if (mime === 'image/svg+xml') return new TextEncoder().encode(raw);
  if (raw.length > 70_000_000) fail('limit_exceeded', 'Encoded output exceeds the media upload limit.');
  try { return Uint8Array.from(atob(raw.replace(/\s/g, '')), character => character.charCodeAt(0)); }
  catch { return fail('unsupported', 'The existing raster output is not valid base64.'); }
}
async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}
export async function exportOutput(context: BrowserOperationContext, operation: BrowserOperationStatus,
  arguments_: Record<string, unknown>): Promise<void> {
  const { cellId, outputId, revision } = requiredRef(arguments_);
  const output = outputLedger(context).resolve(cellId, outputId, revision).model;
  const requested = string(arguments_.mime ?? '', 'mime', 100, true);
  const mime = requested || ['image/png', 'image/jpeg', 'image/svg+xml'].find(item => output.data[item] !== undefined);
  if (!mime || !['image/png', 'image/jpeg', 'image/svg+xml'].includes(mime) || output.data[mime] === undefined)
    fail('unsupported', 'This output has no supported existing raster or SVG MIME.');
  const destination = arguments_.save_to;
  if (destination !== null && destination !== undefined) string(destination, 'save_to', 500);
  const bytes = encoded(output, mime);
  if (bytes.byteLength > 50 * 1024 * 1024) fail('limit_exceeded', 'Output exceeds the media upload limit.');
  const disconnect = outputLedger(context).onInvalidated(ref => {
    if (ref.output_id === outputId) void context.cancel(operation.operation_id).catch(() => undefined);
  });
  context.addOperationCleanup(operation.operation_id, disconnect);
  // Recheck after asynchronous digest, before bytes leave the browser.
  const hash = await sha256(bytes);
  outputLedger(context).resolve(cellId, outputId, revision);
  await context.upload(operation.operation_id, bytes, mime, hash, {},
    destination === undefined ? null : destination as string | null);
}

registerBrowserOperation('list_outputs', async (context, request, operation) => {
  const cellId = string(request.arguments.cell_id, 'cell_id', 200);
  const cursor = string(request.arguments.cursor ?? '', 'cursor', 100, true);
  const limit = integer(request.arguments.limit ?? 10, 'limit', 1, 20);
  await context.transition(operation.operation_id, 'completed', outputLedger(context).list(cellId, cursor, limit));
}, () => ({ available: true }));
registerBrowserOperation('read_output', async (context, request, operation) => {
  await context.transition(operation.operation_id, 'completed', readOutput(outputLedger(context), request.arguments));
}, () => ({ available: true }));
registerBrowserOperation('export_output', async (context, request, operation) => {
  await exportOutput(context, operation, request.arguments);
}, () => ({ available: true, formats: ['image/png', 'image/jpeg', 'image/svg+xml'] }));
