/** Exact, bounded media decoding shared by playback and derivative tools. */
import { BrowserMediaError, BrowserOperationContext } from './browserMediaClient';
import { sha256Bytes } from './browserMediaHash';

export type MediaRef = { media_id: string } | { path: string; sha256: string };
export interface RasterFrameLease {
  bitmap: ImageBitmap;
  actualSeconds: number;
  width: number;
  height: number;
  release(): void;
}
interface LeaseBase {
  mimeType: string;
  sha256: string;
  width: number;
  height: number;
  duration: number | null;
  release(): void;
}
export interface RasterMediaLease extends LeaseBase {
  kind: 'image';
  bitmap: ImageBitmap;
  duration: null;
}
export interface ClipMediaLease extends LeaseBase {
  kind: 'audio' | 'video';
  element: HTMLMediaElement;
  duration: number;
  frameAt(seconds: number, signal?: AbortSignal): Promise<RasterFrameLease>;
}
export type DecodedMediaLease = RasterMediaLease | ClipMediaLease;

const MAX_ENCODED = 50 * 1024 * 1024;
const MAX_CONTEXT_ENCODED = 100 * 1024 * 1024;
const MAX_IMAGE_SIDE = 4096;
const MAX_PIXELS = 16_000_000;
const MAX_CONTEXT_PIXELS = 32_000_000;
const MAX_TAB_PIXELS = 64_000_000;
const MAX_PREVIEWS = 4;
const MAX_DURATION = 300;
interface Budget { pixels: number; encoded: number; previews: number; }
const budgets = new WeakMap<BrowserOperationContext, Budget>();
let tabPixels = 0;

function budget(context: BrowserOperationContext): Budget {
  let value = budgets.get(context);
  if (!value) { value = { pixels: 0, encoded: 0, previews: 0 }; budgets.set(context, value); }
  return value;
}
function reserve(context: BrowserOperationContext, pixels: number, encoded: number, preview: boolean): () => void {
  const usage = budget(context);
  if (pixels > MAX_PIXELS || usage.pixels + pixels > MAX_CONTEXT_PIXELS || tabPixels + pixels > MAX_TAB_PIXELS ||
      usage.encoded + encoded > MAX_CONTEXT_ENCODED || (preview && usage.previews >= MAX_PREVIEWS))
    throw new BrowserMediaError('limit_exceeded', 'Media decoding or preview budget is full. Close a preview and retry.');
  usage.pixels += pixels; usage.encoded += encoded; tabPixels += pixels;
  if (preview) usage.previews++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    usage.pixels -= pixels; usage.encoded -= encoded; tabPixels -= pixels;
    if (preview) usage.previews--;
  };
}
/** Reserve an additional canvas or derivative surface while its pixels remain live. */
export function reserveMediaWorkingPixels(context: BrowserOperationContext, width: number, height: number): () => void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0)
    throw new BrowserMediaError('invalid_argument', 'Invalid media surface dimensions.');
  return reserve(context, width * height, 0, false);
}
function requireCurrent(context: BrowserOperationContext, signal?: AbortSignal): void {
  if (signal?.aborted) throw new BrowserMediaError('cancelled', 'Media operation was cancelled.');
  if (!context.isCurrent()) throw new BrowserMediaError('stale_target', 'The originating notebook changed.');
}

export { sha256Bytes } from './browserMediaHash';

function equalsAscii(bytes: Uint8Array, offset: number, value: string): boolean {
  return [...value].every((char, index) => bytes[offset + index] === char.charCodeAt(0));
}
function imageDimensions(bytes: Uint8Array): { mime: string; width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 24 && equalsAscii(bytes, 1, 'PNG\r\n\x1a\n') && bytes[0] === 0x89 &&
      equalsAscii(bytes, 12, 'IHDR'))
    return { mime: 'image/png', width: view.getUint32(16), height: view.getUint32(20) };
  if (bytes.length >= 10 && (equalsAscii(bytes, 0, 'GIF87a') || equalsAscii(bytes, 0, 'GIF89a')))
    return { mime: 'image/gif', width: view.getUint16(6, true), height: view.getUint16(8, true) };
  if (bytes.length >= 12 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1];
      if (marker === 0xda || marker === 0xd9) break;
      const length = view.getUint16(offset + 2);
      if (length < 2 || offset + 2 + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker))
        return { mime: 'image/jpeg', width: view.getUint16(offset + 7), height: view.getUint16(offset + 5) };
      offset += 2 + length;
    }
  }
  if (bytes.length >= 30 && equalsAscii(bytes, 0, 'RIFF') && equalsAscii(bytes, 8, 'WEBP')) {
    if (equalsAscii(bytes, 12, 'VP8X'))
      return { mime: 'image/webp', width: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)),
        height: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) };
    if (equalsAscii(bytes, 12, 'VP8 ') && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a)
      return { mime: 'image/webp', width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    if (equalsAscii(bytes, 12, 'VP8L') && bytes[20] === 0x2f)
      return { mime: 'image/webp', width: 1 + (((bytes[22] & 0x3f) << 8) | bytes[21]),
        height: 1 + (((bytes[24] & 0x0f) << 10) | (bytes[23] << 2) | (bytes[22] >> 6)) };
  }
  return null;
}
function containerMime(bytes: Uint8Array): 'mp4' | 'webm' | 'ogg' | 'wav' | 'mp3' | null {
  if (bytes.length >= 12 && equalsAscii(bytes, 4, 'ftyp')) return 'mp4';
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3)
    return 'webm';
  if (bytes.length >= 4 && equalsAscii(bytes, 0, 'OggS')) return 'ogg';
  if (bytes.length >= 12 && equalsAscii(bytes, 0, 'RIFF') && equalsAscii(bytes, 8, 'WAVE')) return 'wav';
  if (bytes.length >= 3 && equalsAscii(bytes, 0, 'ID3')) return 'mp3';
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return 'mp3';
  return null;
}
export function inspectEncodedMedia(bytes: Uint8Array, declaredMime: string):
  { kind: 'image' | 'audio' | 'video'; mimeType: string; width: number; height: number } {
  const declared = declaredMime.split(';', 1)[0].toLowerCase().trim();
  if (declared === 'image/svg+xml')
    throw new BrowserMediaError('unsupported', 'SVG preview is unsupported; markup will not be rasterized.');
  const image = imageDimensions(bytes);
  const container = image ? null : containerMime(bytes);
  const supportedContainer = (container === 'mp4' && ['audio/mp4', 'video/mp4'].includes(declared)) ||
    (container === 'webm' && ['audio/webm', 'video/webm'].includes(declared)) ||
    (container === 'ogg' && ['audio/ogg', 'video/ogg'].includes(declared)) ||
    (container === 'wav' && ['audio/wav', 'audio/x-wav'].includes(declared)) ||
    (container === 'mp3' && declared === 'audio/mpeg');
  if ((!image || image.mime !== declared) && !supportedContainer)
    throw new BrowserMediaError('unsupported', 'Media bytes do not match a supported declared format.');
  const kind = declared.startsWith('image/') ? 'image' : declared.startsWith('video/') ? 'video' : 'audio';
  const width = image?.width ?? 0; const height = image?.height ?? 0;
  if (image && (!width || !height || width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE || width * height > MAX_PIXELS))
    throw new BrowserMediaError('limit_exceeded', 'Image dimensions exceed the decoder limit.');
  return { kind, mimeType: declared, width, height };
}

async function waitForMedia(element: HTMLMediaElement, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timer); element.removeEventListener('error', failed);
      element.removeEventListener('loadeddata', ready); element.removeEventListener('canplay', ready);
      signal?.removeEventListener('abort', cancelled);
    };
    const ready = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new BrowserMediaError('unsupported', 'Browser could not decode this media codec.')); };
    const cancelled = () => { cleanup(); reject(new BrowserMediaError('cancelled', 'Media operation was cancelled.')); };
    const timer = window.setTimeout(() => { cleanup(); reject(new BrowserMediaError('timeout', 'Media decoding timed out.')); }, 10_000);
    element.addEventListener('error', failed, { once: true });
    element.addEventListener('loadeddata', ready, { once: true });
    element.addEventListener('canplay', ready, { once: true });
    signal?.addEventListener('abort', cancelled, { once: true });
    try { element.load(); }
    catch (error) { cleanup(); reject(error); }
  });
}

/** One verified decoder lease; callers must release it, including on cancellation. */
export async function loadPlaybackMedia(context: BrowserOperationContext, reference: MediaRef,
  options: { signal?: AbortSignal; preview?: boolean } = {}): Promise<DecodedMediaLease> {
  requireCurrent(context, options.signal);
  const fetched = await context.fetchReference(reference, options.signal);
  requireCurrent(context, options.signal);
  const bytes = new Uint8Array(fetched.data);
  if (!bytes.length || bytes.byteLength > MAX_ENCODED)
    throw new BrowserMediaError('limit_exceeded', 'Media exceeds the 50 MiB decoder limit.');
  const digest = await sha256Bytes(bytes);
  requireCurrent(context, options.signal);
  if (fetched.sha256 !== digest || ('sha256' in reference && reference.sha256 !== digest))
    throw new BrowserMediaError('stale_target', 'Media bytes changed since the exact reference was made.');
  const format = inspectEncodedMedia(bytes, fetched.mimeType);
  const encoded = bytes.byteLength;
  if (format.kind === 'image') {
    const releaseBudget = reserve(context, format.width * format.height, encoded, options.preview === true);
    let bitmap: ImageBitmap | undefined;
    try {
      bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: format.mimeType }));
      requireCurrent(context, options.signal);
      if (bitmap.width !== format.width || bitmap.height !== format.height) {
        throw new BrowserMediaError('stale_target', 'Decoded dimensions differ from encoded media.');
      }
      const decoded = bitmap;
      let released = false;
      return { kind: 'image', mimeType: format.mimeType, sha256: digest, bitmap: decoded,
        width: decoded.width, height: decoded.height, duration: null,
        release: () => { if (released) return; released = true; decoded.close(); releaseBudget(); } };
    } catch (error) { bitmap?.close(); releaseBudget(); throw error; }
  }
  const element = document.createElement(format.kind) as HTMLMediaElement;
  element.preload = 'auto'; element.controls = true;
  if (!element.canPlayType(format.mimeType))
    throw new BrowserMediaError('unsupported', 'This browser does not support the media codec.');
  const releaseEncoded = reserve(context, 0, encoded, options.preview === true);
  let url: string;
  try { url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: format.mimeType })); }
  catch (error) { releaseEncoded(); throw error; }
  element.src = url;
  let releasePixels: (() => void) | undefined;
  let released = false;
  try {
    await waitForMedia(element, options.signal);
    requireCurrent(context, options.signal);
    const duration = element.duration;
    if (!Number.isFinite(duration) || duration < 0 || duration > MAX_DURATION)
      throw new BrowserMediaError('limit_exceeded', 'Media duration exceeds the 300-second decoder limit.');
    const video = element as HTMLVideoElement;
    const width = format.kind === 'video' ? video.videoWidth : 0;
    const height = format.kind === 'video' ? video.videoHeight : 0;
    if (format.kind === 'video' && (!width || !height || width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE || width * height > MAX_PIXELS))
      throw new BrowserMediaError('limit_exceeded', 'Video frame dimensions exceed the decoder limit.');
    releasePixels = reserve(context, width * height, 0, false);
    const release = () => {
      if (released) return;
      released = true; element.pause(); element.removeAttribute('src'); element.load();
      URL.revokeObjectURL(url); releasePixels?.(); releaseEncoded();
    };
    let lastFrame: { requested: number; actual: number } | undefined;
    const frameAt = async (seconds: number, signal?: AbortSignal): Promise<RasterFrameLease> => {
      if (format.kind !== 'video') throw new BrowserMediaError('unsupported', 'Only video has frames.');
      requireCurrent(context, signal);
      if (released) throw new BrowserMediaError('stale_target', 'Decoder lease has closed.');
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > duration)
        throw new BrowserMediaError('invalid_argument', 'Frame timestamp is outside the media duration.');
      const releaseFrameBudget = reserve(context, width * height, 0, false);
      try {
        element.pause();
        const alreadyAtFrame = Math.abs(video.currentTime - seconds) < 0.001 && video.readyState >= 2;
        if (typeof video.requestVideoFrameCallback !== 'function' ||
            typeof video.cancelVideoFrameCallback !== 'function')
          throw new BrowserMediaError('unsupported', 'This browser cannot report decoded frame timestamps.');
        let actualSeconds = alreadyAtFrame && lastFrame?.requested === seconds ? lastFrame.actual : undefined;
        if (actualSeconds === undefined) actualSeconds = await new Promise<number>((resolve, reject) => {
          let frameCallback: number | undefined;
          let sought = false;
          let presented: number | undefined;
          let done = false;
          const cleanup = () => { video.removeEventListener('seeked', onSeek); video.removeEventListener('error', onError);
            signal?.removeEventListener('abort', onAbort); window.clearTimeout(timer);
            if (frameCallback !== undefined) video.cancelVideoFrameCallback(frameCallback);
            done = true; };
          const complete = () => {
            if (!sought || presented === undefined || done) return;
            cleanup(); resolve(presented);
          };
          const onSeek = () => { sought = true; complete(); };
          const onError = () => { cleanup(); reject(new BrowserMediaError('unsupported', 'Video frame could not be decoded.')); };
          const onAbort = () => { cleanup(); reject(new BrowserMediaError('cancelled', 'Frame extraction cancelled.')); };
          const timer = window.setTimeout(() => { cleanup(); reject(new BrowserMediaError('timeout', 'Decoded frame presentation timed out.')); }, 10_000);
          const watchFrame = () => { frameCallback = video.requestVideoFrameCallback((_now, metadata) => {
            if (done) return;
            if (released || !context.isCurrent() || signal?.aborted) {
              cleanup(); reject(new BrowserMediaError('stale_target', 'Decoder lease has closed.')); return;
            }
            if (!Number.isFinite(metadata.mediaTime) || metadata.mediaTime < 0 ||
                metadata.mediaTime > duration + 0.001) {
              cleanup(); reject(new BrowserMediaError('unsupported', 'Decoded frame timestamp is unavailable.'));
              return;
            }
            // WebKit can present the sought frame before firing `seeked`.
            // Retain that presentation, then wait for seek completion before capture.
            if (Math.abs(metadata.mediaTime - seconds) <= 1) presented = metadata.mediaTime;
            complete();
            if (!done) watchFrame();
          }); };
          video.addEventListener('seeked', onSeek, { once: true }); video.addEventListener('error', onError, { once: true });
          signal?.addEventListener('abort', onAbort, { once: true });
          watchFrame();
          // Assigning the same currentTime may not seek; a tiny nudge still presents its frame.
          video.currentTime = alreadyAtFrame
            ? (seconds + 0.0001 < duration ? seconds + 0.0001 : Math.max(0, seconds - 0.0001))
            : seconds;
        });
        requireCurrent(context, signal);
        const bitmap = await createImageBitmap(video);
        if (released || !context.isCurrent() || signal?.aborted) {
          bitmap.close(); requireCurrent(context, signal);
          throw new BrowserMediaError('stale_target', 'Decoder lease has closed.');
        }
        lastFrame = { requested: seconds, actual: actualSeconds };
        let frameReleased = false;
        return { bitmap, actualSeconds, width: bitmap.width, height: bitmap.height,
          release: () => { if (frameReleased) return; frameReleased = true; bitmap.close(); releaseFrameBudget(); } };
      } catch (error) { releaseFrameBudget(); throw error; }
    };
    return { kind: format.kind, mimeType: format.mimeType, sha256: digest, element,
      width, height, duration, release, frameAt } as ClipMediaLease;
  } catch (error) {
    element.pause(); element.removeAttribute('src'); element.load(); URL.revokeObjectURL(url);
    releasePixels?.(); releaseEncoded(); throw error;
  }
}

/** Raster transform input without a preview slot; release in a finally block. */
export async function decodeRasterMedia(context: BrowserOperationContext, reference: MediaRef,
  signal?: AbortSignal): Promise<RasterMediaLease> {
  const lease = await loadPlaybackMedia(context, reference, { signal });
  if (lease.kind !== 'image') { lease.release(); throw new BrowserMediaError('unsupported', 'Expected a raster image.'); }
  return lease;
}
