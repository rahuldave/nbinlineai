/** Output-only composition of supported materialized notebook renderers. */
import { BrowserMediaError, BrowserOperationContext, BrowserOperationStatus,
  registerBrowserOperation } from './browserMediaClient';
import { materializedOutput } from './browserNotebookCanvas';
import { OutputRef, outputLedger } from './browserNotebookOutputs';
import { sha256Bytes } from './browserMediaHash';

interface Surface { ref: OutputRef; node: HTMLElement; element: HTMLImageElement | HTMLCanvasElement;
  rect: DOMRect; dispose?: () => void; }
function fail(code: string, message: string): never { throw new BrowserMediaError(code, message); }
function boundedMax(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 4096)
    fail('invalid_argument', 'max_size must be an integer from 1 to 4096.');
  return value;
}
function sourceText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.every(part => typeof part === 'string')) return value.join('');
  return fail('unsupported', 'Existing SVG output has no native markup bytes.');
}
function visible(rect: DOMRect, frame: DOMRect): boolean {
  return rect.width > 0 && rect.height > 0 && rect.top >= frame.top && rect.left >= frame.left &&
    rect.bottom <= frame.bottom && rect.right <= frame.right;
}
async function svgImage(markup: string): Promise<{ image: HTMLImageElement; dispose: () => void }> {
  const blob = new Blob([markup], { type: 'image/svg+xml' });
  if (blob.size > 50 * 1024 * 1024) fail('limit_exceeded', 'SVG output exceeds the capture limit.');
  const url = URL.createObjectURL(blob);
  const image = new Image(); image.src = url;
  try { await image.decode(); }
  catch { URL.revokeObjectURL(url); return fail('unsupported', 'Existing SVG cannot be decoded for raster region capture.'); }
  return { image, dispose: () => URL.revokeObjectURL(url) };
}
async function surface(context: BrowserOperationContext, ref: OutputRef, frame: DOMRect): Promise<Surface> {
  const rendered = materializedOutput(context, ref);
  if (!rendered) fail('unsupported', `Cell ${ref.cell_id} has an offscreen or unrendered output.`);
  const { node, mime } = rendered;
  let element: HTMLImageElement | HTMLCanvasElement;
  let dispose: (() => void) | undefined;
  if (mime === 'image/png' || mime === 'image/jpeg') {
    const images = node.querySelectorAll<HTMLImageElement>('.jp-RenderedImage img');
    if (images.length !== 1 || !images[0].complete || !images[0].naturalWidth)
      fail('unsupported', `Cell ${ref.cell_id} has no ready stock raster renderer.`);
    element = images[0];
  } else if (mime === 'image/svg+xml') {
    const svg = node.querySelector<SVGSVGElement>('.jp-RenderedSVG svg');
    if (!svg) fail('unsupported', `Cell ${ref.cell_id} has no ready stock SVG renderer.`);
    const markup = sourceText(outputLedger(context).resolve(ref.cell_id, ref.output_id, ref.revision).model.data[mime]);
    const decoded = await svgImage(markup);
    element = decoded.image; dispose = decoded.dispose;
  } else if (mime === 'text/html') {
    const html = node.querySelector<HTMLElement>('.jp-RenderedHTMLCommon');
    const canvases = html?.querySelectorAll<HTMLCanvasElement>('canvas');
    if (!html || canvases?.length !== 1 || html.querySelector('iframe,video,img,svg,table,button,input,script') ||
        html.textContent?.trim()) fail('unsupported', `Cell ${ref.cell_id} has mixed or unsupported HTML output.`);
    element = canvases[0];
    if (!element.width || !element.height) fail('unsupported', `Cell ${ref.cell_id} has a blank canvas surface.`);
  } else return fail('unsupported', `Cell ${ref.cell_id} has unsupported rendered MIME ${mime ?? 'unknown'}.`);
  const sourceWidth = element instanceof HTMLImageElement ? element.naturalWidth : element.width;
  const sourceHeight = element instanceof HTMLImageElement ? element.naturalHeight : element.height;
  if (!sourceWidth || !sourceHeight || sourceWidth * sourceHeight > 32_000_000) {
    dispose?.();
    fail('limit_exceeded', `Cell ${ref.cell_id} output exceeds the safe readback limit.`);
  }
  const rect = mime === 'image/svg+xml' ? node.querySelector<SVGSVGElement>('.jp-RenderedSVG svg')!.getBoundingClientRect()
    : element.getBoundingClientRect();
  if (!visible(rect, frame)) { dispose?.(); fail('unsupported', `Cell ${ref.cell_id} output is not fully visible.`); }
  return { ref, node, element, rect, dispose };
}
function png(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    try { canvas.toBlob(blob => blob ? void blob.arrayBuffer().then(buffer => resolve(new Uint8Array(buffer)), reject)
      : reject(new BrowserMediaError('unsupported', 'The region contains a cross-origin or unreadable surface.')), 'image/png'); }
    catch { reject(new BrowserMediaError('unsupported', 'The region contains a cross-origin or unreadable surface.')); }
  });
}
function stillCurrent(context: BrowserOperationContext, all: Surface[]): void {
  for (const item of all) {
    outputLedger(context).resolve(item.ref.cell_id, item.ref.output_id, item.ref.revision);
    if (materializedOutput(context, item.ref)?.node !== item.node || !item.node.isConnected)
      fail('stale_target', 'A captured output renderer changed.');
  }
}
export async function captureNotebookRegion(context: BrowserOperationContext,
  operation: BrowserOperationStatus, arguments_: Record<string, unknown>): Promise<void> {
  const ids = arguments_.cell_ids;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 12 ||
      ids.some(value => typeof value !== 'string' || !value || value.length > 200) ||
      new Set(ids).size !== ids.length) fail('invalid_argument', 'Select 1 to 12 distinct live cell IDs.');
  const maxSize = boundedMax(arguments_.max_size ?? 1280);
  const save = arguments_.save_to;
  if (save !== null && save !== undefined && (typeof save !== 'string' || !save.trim() || save.length > 500))
    fail('invalid_argument', 'save_to must be None or a nonempty path.');
  const notebook = context.panel.content;
  const frame = notebook.node.getBoundingClientRect();
  const surfaces: Surface[] = [];
  const disconnect = outputLedger(context).onInvalidated(ref => {
    if (surfaces.some(item => item.ref.output_id === ref.output_id))
      void context.cancel(operation.operation_id).catch(() => undefined);
  });
  context.addOperationCleanup(operation.operation_id, disconnect);
  try {
    for (const cellId of ids as string[]) {
      const page = outputLedger(context).list(cellId, '', 20);
      if (!page.outputs.length || page.next_cursor)
        fail('unsupported', `Cell ${cellId} has no outputs or too many to capture completely.`);
      for (const ref of page.outputs) {
        if (surfaces.length >= 12) fail('limit_exceeded', 'A region may contain at most 12 output surfaces.');
        surfaces.push(await surface(context, ref, frame));
      }
    }
    stillCurrent(context, surfaces);
    const left = Math.min(...surfaces.map(item => item.rect.left));
    const top = Math.min(...surfaces.map(item => item.rect.top));
    const right = Math.max(...surfaces.map(item => item.rect.right));
    const bottom = Math.max(...surfaces.map(item => item.rect.bottom));
    const width = right - left, height = bottom - top;
    if (width <= 0 || height <= 0 || width * height > 32_000_000)
      fail('limit_exceeded', 'Visible output region exceeds the composition limit.');
    const factor = Math.min(1, maxSize / Math.max(width, height), Math.sqrt(16_000_000 / (width * height)));
    const target = document.createElement('canvas');
    target.width = Math.max(1, Math.round(width * factor));
    target.height = Math.max(1, Math.round(height * factor));
    const drawing = target.getContext('2d');
    if (!drawing) fail('unsupported', '2D canvas is unavailable.');
    for (const item of surfaces) {
      try { drawing.drawImage(item.element, (item.rect.left - left) * factor,
        (item.rect.top - top) * factor, item.rect.width * factor, item.rect.height * factor); }
      catch { fail('unsupported', `Cell ${item.ref.cell_id} output cannot be read back.`); }
    }
    const bytes = await png(target);
    if (bytes.byteLength > 50 * 1024 * 1024)
      fail('limit_exceeded', 'Region still exceeds the encoded media limit.');
    stillCurrent(context, surfaces);
    const digest = await sha256Bytes(bytes);
    stillCurrent(context, surfaces);
    await context.upload(operation.operation_id, bytes, 'image/png', digest, {},
      save === undefined ? null : save as string | null);
  } finally { surfaces.forEach(item => item.dispose?.()); disconnect(); }
}
registerBrowserOperation('capture_notebook_region', async (context, request, operation) => {
  await captureNotebookRegion(context, operation, request.arguments);
}, () => ({ available: true, formats: ['image/png'] }));
