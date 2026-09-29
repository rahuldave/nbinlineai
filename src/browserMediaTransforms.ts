/** Exact, bounded raster derivatives using the shared notebook media decoder. */
import { BrowserMediaError, BrowserOperationContext, BrowserOperationRequest,
  BrowserOperationStatus, registerBrowserOperation } from './browserMediaClient';
import { MediaRef, decodeRasterMedia, loadPlaybackMedia, reserveMediaWorkingPixels,
  sha256Bytes } from './browserMediaDecoder';

type Annotation = Record<string, unknown>;
const MAX_BATCH_PIXELS = 32_000_000;
const MAX_ENCODED_BATCH = 50 * 1024 * 1024;

function live(context: BrowserOperationContext, signal: AbortSignal): void {
  if (signal.aborted) throw new BrowserMediaError('cancelled', 'Media transformation was cancelled.');
  if (!context.isCurrent()) throw new BrowserMediaError('stale_target', 'The originating notebook changed.');
}
function integer(value: unknown, name: string, positive = false): number {
  if (!Number.isSafeInteger(value) || (value as number) < (positive ? 1 : 0) || (value as number) > 4096)
    throw new BrowserMediaError('invalid_argument', `${name} must be an in-range pixel integer.`);
  return value as number;
}
function numberIn(value: unknown, name: string, low: number, high: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < low || value > high)
    throw new BrowserMediaError('invalid_argument', `${name} is out of range.`);
  return value;
}
function reference(value: unknown): MediaRef {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BrowserMediaError('invalid_argument', 'Media must be an exact reference.');
  const record = value as Record<string, unknown>;
  if (typeof record.media_id === 'string' && record.media_id.length <= 100 && record.media_id)
    return { media_id: record.media_id };
  if (typeof record.path === 'string' && record.path.length <= 500 && record.path &&
      typeof record.sha256 === 'string' && /^[0-9a-f]{64}$/.test(record.sha256))
    return { path: record.path, sha256: record.sha256 };
  throw new BrowserMediaError('invalid_argument', 'Media needs a memory ID or an exact saved path and hash.');
}
function saveTo(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !value || value.length > 500)
    throw new BrowserMediaError('invalid_argument', 'save_to must be an unused server-root-relative destination.');
  return value;
}
function drawable(context: BrowserOperationContext, width: number, height: number):
  { canvas: HTMLCanvasElement; drawing: CanvasRenderingContext2D; release: () => void } {
  const release = reserveMediaWorkingPixels(context, width, height);
  try {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const drawing = canvas.getContext('2d', { alpha: false });
    if (!drawing) throw new BrowserMediaError('unsupported', 'Canvas drawing is unavailable.');
    return { canvas, drawing, release };
  } catch (error) { release(); throw error; }
}
function abortable<T>(promise: Promise<T>, signal: AbortSignal, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort);
      reject(new BrowserMediaError('cancelled', message)); };
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); },
      error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}
async function encodedPng(canvas: HTMLCanvasElement, context: BrowserOperationContext,
  signal: AbortSignal): Promise<Uint8Array> {
  live(context, signal);
  const blob = await new Promise<Blob>((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort);
      reject(new BrowserMediaError('cancelled', 'PNG encoding was cancelled.')); };
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    try {
      canvas.toBlob(value => {
        signal.removeEventListener('abort', abort);
        if (signal.aborted) return;
        if (value) resolve(value);
        else reject(new BrowserMediaError('unsupported', 'Browser could not encode the derivative PNG.'));
      }, 'image/png');
    } catch (error) { signal.removeEventListener('abort', abort); reject(error); }
  });
  live(context, signal);
  if (!blob.size || blob.size > 50 * 1024 * 1024)
    throw new BrowserMediaError('limit_exceeded', 'Encoded derivative exceeds 50 MiB.');
  const bytes = new Uint8Array(await abortable(blob.arrayBuffer(), signal, 'PNG reading was cancelled.'));
  live(context, signal);
  return bytes;
}
function color(value: unknown): string {
  if (value === undefined) return '#e53935';
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value))
    throw new BrowserMediaError('invalid_argument', 'Annotation color must be an opaque six-digit hex value.');
  return value;
}
function shapeBounds(x: number, y: number, width: number, height: number,
  sourceWidth: number, sourceHeight: number): void {
  if (x + width > sourceWidth || y + height > sourceHeight)
    throw new BrowserMediaError('invalid_argument', 'Shape or crop extends outside source pixels.');
}
function drawAnnotation(drawing: CanvasRenderingContext2D, item: Annotation,
  width: number, height: number): void {
  const type = item.type;
  if (type === 'rectangle' || type === 'redaction') {
    const x = integer(item.x, 'x'); const y = integer(item.y, 'y');
    const w = integer(item.width, 'width', true); const h = integer(item.height, 'height', true);
    shapeBounds(x, y, w, h, width, height);
    if (type === 'redaction') {
      drawing.fillStyle = '#000000'; drawing.globalAlpha = 1;
      drawing.fillRect(x, y, w, h); return;
    }
    drawing.strokeStyle = color(item.color);
    drawing.lineWidth = item.line_width === undefined ? 2 : numberIn(item.line_width, 'line_width', 1, 32);
    drawing.strokeRect(x + drawing.lineWidth / 2, y + drawing.lineWidth / 2,
      Math.max(0, w - drawing.lineWidth), Math.max(0, h - drawing.lineWidth));
    return;
  }
  if (type === 'text') {
    const x = integer(item.x, 'x'); const y = integer(item.y, 'y');
    if (x >= width || y >= height || typeof item.text !== 'string' || !item.text || item.text.length > 200)
      throw new BrowserMediaError('invalid_argument', 'Text annotation is invalid or outside source pixels.');
    drawing.fillStyle = color(item.color);
    const size = item.font_size === undefined ? 16 : numberIn(item.font_size, 'font_size', 8, 96);
    drawing.font = `${size}px sans-serif`; drawing.textBaseline = 'top';
    drawing.fillText(item.text, x, y, width - x);
    return;
  }
  if (type === 'arrow') {
    const x1 = integer(item.x1, 'x1'); const y1 = integer(item.y1, 'y1');
    const x2 = integer(item.x2, 'x2'); const y2 = integer(item.y2, 'y2');
    if ([x1, x2].some(x => x >= width) || [y1, y2].some(y => y >= height))
      throw new BrowserMediaError('invalid_argument', 'Arrow extends outside source pixels.');
    const angle = Math.atan2(y2 - y1, x2 - x1);
    drawing.strokeStyle = color(item.color);
    drawing.lineWidth = item.line_width === undefined ? 2 : numberIn(item.line_width, 'line_width', 1, 32);
    drawing.beginPath(); drawing.moveTo(x1, y1); drawing.lineTo(x2, y2);
    for (const direction of [-1, 1]) {
      drawing.moveTo(x2, y2);
      drawing.lineTo(x2 - 10 * Math.cos(angle + direction * Math.PI / 6),
        y2 - 10 * Math.sin(angle + direction * Math.PI / 6));
    }
    drawing.stroke(); return;
  }
  throw new BrowserMediaError('invalid_argument', 'Unsupported annotation shape.');
}

export async function cropImage(context: BrowserOperationContext, request: BrowserOperationRequest,
  operation: BrowserOperationStatus): Promise<void> {
  const args = request.arguments;
  const signal = context.operationSignal(operation.operation_id);
  const lease = await decodeRasterMedia(context, reference(args.media), signal);
  try {
    const x = integer(args.x, 'x'); const y = integer(args.y, 'y');
    const width = integer(args.width, 'width', true); const height = integer(args.height, 'height', true);
    shapeBounds(x, y, width, height, lease.width, lease.height);
    const surface = drawable(context, width, height);
    try {
      surface.drawing.drawImage(lease.bitmap, x, y, width, height, 0, 0, width, height);
      const data = await encodedPng(surface.canvas, context, signal);
      const hash = await sha256Bytes(data); live(context, signal);
      await context.upload(operation.operation_id, data, 'image/png', hash,
        { source_sha256: lease.sha256, transform: 'crop_image' }, saveTo(args.save_to));
    } finally { surface.release(); }
  } finally { lease.release(); }
}

export async function annotateImage(context: BrowserOperationContext, request: BrowserOperationRequest,
  operation: BrowserOperationStatus): Promise<void> {
  const args = request.arguments;
  const signal = context.operationSignal(operation.operation_id);
  const lease = await decodeRasterMedia(context, reference(args.media), signal);
  try {
    const annotations = args.annotations;
    if (!Array.isArray(annotations) || !annotations.length || annotations.length > 50)
      throw new BrowserMediaError('invalid_argument', 'Specify 1 through 50 annotations.');
    const surface = drawable(context, lease.width, lease.height);
    try {
      surface.drawing.drawImage(lease.bitmap, 0, 0);
      for (const annotation of annotations) {
        live(context, signal);
        if (!annotation || typeof annotation !== 'object' || Array.isArray(annotation))
          throw new BrowserMediaError('invalid_argument', 'Invalid annotation shape.');
        drawAnnotation(surface.drawing, annotation as Annotation, lease.width, lease.height);
      }
      const data = await encodedPng(surface.canvas, context, signal);
      const hash = await sha256Bytes(data); live(context, signal);
      await context.upload(operation.operation_id, data, 'image/png', hash,
        { source_sha256: lease.sha256, transform: 'annotate_image' }, saveTo(args.save_to));
    } finally { surface.release(); }
  } finally { lease.release(); }
}

export async function extractFrames(context: BrowserOperationContext, request: BrowserOperationRequest,
  operation: BrowserOperationStatus): Promise<void> {
  const args = request.arguments;
  const signal = context.operationSignal(operation.operation_id);
  const timestamps = args.timestamps;
  if (!Array.isArray(timestamps) || !timestamps.length || timestamps.length > 12)
    throw new BrowserMediaError('invalid_argument', 'Specify 1 through 12 frame timestamps.');
  const requested = timestamps.map(value => numberIn(value, 'timestamp', 0, 300));
  const destination = saveTo(args.save_to);
  const lease = await loadPlaybackMedia(context, reference(args.media), { signal });
  if (lease.kind !== 'video') {
    lease.release(); throw new BrowserMediaError('unsupported', 'Frame extraction requires a decoded video.');
  }
  let began = false;
  try {
    if (lease.width * lease.height * requested.length > MAX_BATCH_PIXELS)
      throw new BrowserMediaError('limit_exceeded', 'Frame batch exceeds 32 million decoded pixels.');
    for (const seconds of requested) {
      if (seconds > lease.duration)
        throw new BrowserMediaError('invalid_argument', 'Requested frame is beyond the decoded duration.');
    }
    live(context, signal);
    await context.beginBatch(operation.operation_id, requested.length);
    began = true;
    let encodedTotal = 0;
    for (let index = 0; index < requested.length; index++) {
      live(context, signal);
      const frame = await lease.frameAt(requested[index], signal);
      try {
        const surface = drawable(context, frame.width, frame.height);
        try {
          surface.drawing.drawImage(frame.bitmap, 0, 0);
          const data = await encodedPng(surface.canvas, context, signal);
          encodedTotal += data.byteLength;
          if (encodedTotal > MAX_ENCODED_BATCH)
            throw new BrowserMediaError('limit_exceeded', 'Encoded frame batch exceeds 50 MiB.');
          const hash = await sha256Bytes(data); live(context, signal);
          await context.upload(operation.operation_id, data, 'image/png', hash,
            { source_sha256: lease.sha256, transform: 'extract_frames',
              actual_seconds: frame.actualSeconds }, null, index);
        } finally { surface.release(); }
      } finally { frame.release(); }
    }
    live(context, signal);
    await context.finishBatch(operation.operation_id, destination);
  } catch (error) {
    if (began) await context.cancel(operation.operation_id).catch(() => undefined);
    throw error;
  } finally { lease.release(); }
}

export function registerTransformOperations(): void {
  registerBrowserOperation('extract_frames', extractFrames, () => ({ available: true }));
  registerBrowserOperation('crop_image', cropImage, () => ({ available: true }));
  registerBrowserOperation('annotate_image', annotateImage, () => ({ available: true }));
}
