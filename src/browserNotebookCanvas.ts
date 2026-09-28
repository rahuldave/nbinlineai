/** Passive canvas adapter scoped to a bound, already-rendered stock output. */
import type { CodeCell } from '@jupyterlab/cells';
import { BrowserMediaError, BrowserOperationContext, BrowserOperationStatus, BrowserSource,
  registerBrowserOperation } from './browserMediaClient';
import { OutputRef, outputLedger } from './browserNotebookOutputs';
import { recordingSourceEnded } from './browserMediaRecorder';
import { sha256Bytes } from './browserMediaHash';

export interface CanvasRef extends Pick<OutputRef, 'cell_id' | 'output_id' | 'revision'> {
  canvas_id: string;
  view_revision: number;
}
interface CanvasEntry { ref: CanvasRef; node: HTMLCanvasElement; widget: CodeCell;
  outputWidget: HTMLElement; observer: MutationObserver; sources: Set<string>; }
const registries = new WeakMap<BrowserOperationContext, CanvasRegistry>();
function fail(code: string, message: string): never { throw new BrowserMediaError(code, message); }
function id(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
}
function boundedInt(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum)
    fail('invalid_argument', `${label} must be an integer from ${minimum} to ${maximum}.`);
  return value;
}
function exactRef(value: unknown): CanvasRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid_argument', 'canvas must be a CanvasRef.');
  const ref = value as Record<string, unknown>;
  if (Object.keys(ref).some(key => !['canvas_id', 'cell_id', 'output_id', 'revision', 'view_revision',
    'width', 'height'].includes(key)))
    fail('invalid_argument', 'canvas must be an exact CanvasRef.');
  for (const key of ['canvas_id', 'cell_id', 'output_id'])
    if (typeof ref[key] !== 'string' || !ref[key] || (ref[key] as string).length > 200)
      fail('invalid_argument', `Invalid canvas ${key}.`);
  boundedInt(ref.revision, 'revision', 0, 1_000_000_000);
  boundedInt(ref.view_revision, 'view_revision', 0, 1_000_000_000);
  return { canvas_id: ref.canvas_id as string, cell_id: ref.cell_id as string,
    output_id: ref.output_id as string, revision: ref.revision as number,
    view_revision: ref.view_revision as number };
}
function outputWidget(context: BrowserOperationContext, ref: Pick<OutputRef, 'cell_id' | 'output_id' | 'revision'>): { cell: CodeCell; node: HTMLElement } | null {
  const notebook = context.panel.content;
  const widget = notebook.widgets.find(item => item.model.id === ref.cell_id);
  if (!widget || widget.isPlaceholder() || widget.isDisposed || widget.model.type !== 'code' ||
      !widget.node.isConnected || !context.panel.node.contains(widget.node)) return null;
  const cell = widget as CodeCell;
  const resolved = outputLedger(context).resolve(ref.cell_id, ref.output_id, ref.revision);
  const cells = notebook.model?.cells;
  let bound = false;
  if (cells) for (let i = 0; i < cells.length; i++)
    if (cells.get(i) === cell.model && cells.get(i).id === ref.cell_id) { bound = true; break; }
  if (!bound) return null;
  if (cell.outputArea.model !== cell.model.outputs) return null;
  const output = cell.outputArea.widgets[resolved.index];
  if (!output || output.isDisposed || !output.node.isConnected ||
      !cell.outputArea.node.contains(output.node)) return null;
  return { cell, node: output.node };
}
export function materializedOutput(context: BrowserOperationContext,
  ref: Pick<OutputRef, 'cell_id' | 'output_id' | 'revision'>):
  { cell: CodeCell; node: HTMLElement; mime: string | undefined } | null {
  const resolved = outputLedger(context).resolve(ref.cell_id, ref.output_id, ref.revision);
  const materialized = outputWidget(context, ref);
  if (!materialized) return null;
  const mime = materialized.cell.outputArea.rendermime.preferredMimeType(resolved.model.data,
    resolved.model.trusted ? 'any' : 'ensure') ?? undefined;
  return { ...materialized, mime };
}
function stockHtml(context: BrowserOperationContext, ref: Pick<OutputRef, 'cell_id' | 'output_id' | 'revision'>): { cell: CodeCell; node: HTMLElement } | null {
  const materialized = materializedOutput(context, ref);
  if (!materialized) return null;
  if (materialized.mime !== 'text/html' || !materialized.node.querySelector('.jp-RenderedHTMLCommon')) return null;
  return materialized;
}
function png(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    try { canvas.toBlob(blob => blob ? void blob.arrayBuffer().then(buffer => resolve(new Uint8Array(buffer)), reject)
      : reject(new BrowserMediaError('unsupported', 'Canvas readback was denied or unavailable.')), 'image/png'); }
    catch { reject(new BrowserMediaError('unsupported', 'Canvas is cross-origin-tainted or cannot be read.')); }
  });
}
function scale(width: number, height: number, maxSize: number): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
    fail('unsupported', 'Canvas has no drawable pixels.');
  if (width * height > 32_000_000)
    fail('limit_exceeded', 'Canvas source exceeds the safe readback limit.');
  const factor = Math.min(1, maxSize / Math.max(width, height), Math.sqrt(16_000_000 / (width * height)));
  return { width: Math.max(1, Math.round(width * factor)), height: Math.max(1, Math.round(height * factor)) };
}
function destination(value: unknown, fallback: string | null): string | null {
  const result = value === undefined ? fallback : value;
  if (result !== null && (typeof result !== 'string' || !result.trim() || result.length > 500))
    fail('invalid_argument', 'save_to must be None or a nonempty server-root-relative path.');
  return result as string | null;
}

export class CanvasRegistry {
  private readonly entries = new Map<string, CanvasEntry>();
  private readonly viewRevisions = new Map<string, number>();
  private readonly disconnect: () => void;
  constructor(readonly context: BrowserOperationContext) {
    this.disconnect = outputLedger(context).onInvalidated(ref => {
      for (const entry of Array.from(this.entries.values()))
        if (entry.ref.output_id === ref.output_id) this.drop(entry, 'source_ended');
    });
    context.addCleanup(() => this.dispose());
  }
  private drop(entry: CanvasEntry, reason: 'source_ended' | 'cancelled'): void {
    if (!this.entries.delete(entry.ref.canvas_id)) return;
    entry.observer.disconnect();
    this.viewRevisions.set(entry.ref.output_id,
      (this.viewRevisions.get(entry.ref.output_id) ?? 0) + 1);
    for (const sourceId of entry.sources) void this.context.endSource(sourceId, reason).catch(() => undefined);
  }
  private invalidateView(outputId: string): void {
    for (const entry of Array.from(this.entries.values()))
      if (entry.ref.output_id === outputId) this.drop(entry, 'source_ended');
  }
  private current(entry: CanvasEntry): boolean {
    try {
      const bound = stockHtml(this.context, entry.ref);
      return !!bound && bound.cell === entry.widget && bound.node === entry.outputWidget &&
        bound.node.contains(entry.node) && entry.node.isConnected;
    } catch { return false; }
  }
  list(ref: OutputRef, cursor: string, limit: number): Record<string, unknown> {
    const materialized = stockHtml(this.context, ref);
    if (!materialized) return { available: false, reason: 'This output is not a materialized stock HTML renderer.',
      canvases: [], next_cursor: null };
    const nodes = Array.from(materialized.node.querySelectorAll<HTMLCanvasElement>('.jp-RenderedHTMLCommon canvas'));
    if (!nodes.length) return { available: false, reason: 'This supported renderer exposes no canvas.',
      canvases: [], next_cursor: null };
    if (nodes.length > 20) fail('limit_exceeded', 'This output has more than 20 canvases.');
    const viewRevision = this.viewRevisions.get(ref.output_id) ?? 0;
    const parts = cursor ? /^(\d+):(\d+)$/.exec(cursor) : null;
    if (cursor && (!parts || Number(parts[1]) !== viewRevision))
      fail('stale_target', 'Rendered canvas list changed; start again.');
    const offset = parts ? Number(parts[2]) : 0;
    boundedInt(offset, 'cursor', 0, 20);
    const selected = nodes.slice(offset, offset + limit);
    const canvases = selected.map(node => {
      let entry = Array.from(this.entries.values()).find(item => item.node === node &&
        item.ref.output_id === ref.output_id && item.ref.revision === ref.revision && this.current(item));
      if (!entry) {
        const canvasRef: CanvasRef = { cell_id: ref.cell_id, output_id: ref.output_id,
          revision: ref.revision, canvas_id: id(), view_revision: viewRevision };
        const observer = new MutationObserver(records => {
          if (entry && (records.some(record => entry!.outputWidget.contains(record.target)) ||
              !this.current(entry))) this.invalidateView(entry.ref.output_id);
        });
        entry = { ref: canvasRef, node, widget: materialized.cell,
          outputWidget: materialized.node, observer, sources: new Set() };
        this.entries.set(canvasRef.canvas_id, entry);
        observer.observe(this.context.panel.content.node, { childList: true, subtree: true });
      }
      return { ...entry.ref, width: node.width, height: node.height };
    });
    while (canvases.length > 1 && JSON.stringify({ canvases }).length > 3000) canvases.pop();
    return { available: true, canvases, next_cursor: offset + canvases.length < nodes.length
      ? `${viewRevision}:${offset + canvases.length}` : null };
  }
  resolve(ref: CanvasRef): CanvasEntry {
    const entry = this.entries.get(ref.canvas_id);
    if (!entry || entry.ref.cell_id !== ref.cell_id || entry.ref.output_id !== ref.output_id ||
        entry.ref.revision !== ref.revision || entry.ref.view_revision !== ref.view_revision ||
        !this.current(entry)) {
      if (entry) this.drop(entry, 'source_ended');
      return fail('stale_target', 'Canvas or its rendered output changed; list canvases again.');
    }
    return entry;
  }
  trackSource(entry: CanvasEntry, sourceId: string): void { entry.sources.add(sourceId); }
  dispose(): void {
    this.disconnect();
    for (const entry of Array.from(this.entries.values())) this.drop(entry, 'cancelled');
  }
}
export function canvasRegistry(context: BrowserOperationContext): CanvasRegistry {
  let registry = registries.get(context);
  if (!registry) { registry = new CanvasRegistry(context); registries.set(context, registry); }
  return registry;
}

async function capture(context: BrowserOperationContext, operation: BrowserOperationStatus,
  rawRef: unknown, saveTo: string | null, maxSize: number): Promise<void> {
  const ref = exactRef(rawRef);
  const entry = canvasRegistry(context).resolve(ref);
  const size = scale(entry.node.width, entry.node.height, maxSize);
  const image = document.createElement('canvas');
  image.width = size.width; image.height = size.height;
  const drawing = image.getContext('2d');
  if (!drawing) fail('unsupported', '2D canvas is unavailable.');
  try { drawing.drawImage(entry.node, 0, 0, size.width, size.height); }
  catch { fail('unsupported', 'Canvas could not be read as a raster image.'); }
  const bytes = await png(image);
  if (bytes.byteLength > 50 * 1024 * 1024)
    fail('limit_exceeded', 'Canvas still exceeds the encoded media limit.');
  canvasRegistry(context).resolve(ref);
  const hash = await sha256Bytes(bytes);
  canvasRegistry(context).resolve(ref);
  await context.upload(operation.operation_id, bytes, 'image/png', hash, {}, saveTo);
}
registerBrowserOperation('list_canvases', async (context, request, operation) => {
  const args = request.arguments;
  const ref = outputLedger(context).resolve(String(args.cell_id), String(args.output_id),
    boundedInt(args.revision, 'revision', 0, 1_000_000_000)).ref;
  const cursor = args.cursor ?? '';
  if (typeof cursor !== 'string' || cursor.length > 20) fail('invalid_argument', 'Invalid canvas cursor.');
  const limit = boundedInt(args.limit ?? 10, 'limit', 1, 20);
  await context.transition(operation.operation_id, 'completed', canvasRegistry(context).list(ref, cursor, limit));
}, () => ({ available: true }));
for (const name of ['capture_canvas', 'export_canvas'])
  registerBrowserOperation(name, async (context, request, operation) => {
    const args = request.arguments;
    const max = boundedInt(args.max_size ?? 1280, 'max_size', 1, 4096);
    await capture(context, operation, args.canvas, destination(args.save_to,
      name === 'export_canvas' ? 'auto' : null), max);
  }, () => ({ available: true, formats: ['image/png'] }));

registerBrowserOperation('start_canvas', async (context, request, operation) => {
  const ref = exactRef(request.arguments.canvas);
  const rate = boundedInt(request.arguments.frame_rate ?? 30, 'frame_rate', 1, 60);
  const entry = canvasRegistry(context).resolve(ref);
  if (typeof entry.node.captureStream !== 'function') fail('unsupported', 'Canvas video capture is unavailable here.');
  let stream: MediaStream;
  try { stream = entry.node.captureStream(rate); }
  catch { return fail('unsupported', 'Canvas video capture was refused.'); }
  const tracks = stream.getVideoTracks();
  if (tracks.length !== 1 || stream.getAudioTracks().length) {
    stream.getTracks().forEach(track => track.stop());
    fail('unsupported', 'Canvas did not produce one video-only track.');
  }
  let source: BrowserSource;
  try {
    source = context.registerSource({ kind: 'canvas', tracks, actions: ['start_recording', 'stop_source'],
      onEnded: reason => recordingSourceEnded(context, source.sourceId, reason) });
  } catch (error) { tracks.forEach(track => track.stop()); throw error; }
  entry.sources.add(source.sourceId);
  try {
    canvasRegistry(context).resolve(ref);
    await context.transition(operation.operation_id, 'completed', {
      source_id: source.sourceId, kind: 'canvas', video: true, audio: false,
      requested_frame_rate: rate, actual_frame_rate: tracks[0].getSettings().frameRate ?? null,
      width: entry.node.width, height: entry.node.height,
      note: 'Canvas frames may be throttled when the notebook is in the background.' });
  } catch (error) {
    await context.endSource(source.sourceId, 'cancelled');
    throw error;
  }
}, () => ({ available: typeof HTMLCanvasElement !== 'undefined' &&
  typeof HTMLCanvasElement.prototype.captureStream === 'function' }));
