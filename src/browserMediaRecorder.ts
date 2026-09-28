/** One recorder implementation shared by device, display, and canvas sources. */
import { BrowserMediaError, BrowserOperationContext, BrowserOperationStatus, BrowserSource } from './browserMediaClient';
import { sha256Bytes } from './browserMediaHash';

export type RecordingStopReason = 'user' | 'duration' | 'size' | 'source_ended';

export interface RecordingHandle {
  operationId: string;
  sourceId: string;
  finalize(reason: RecordingStopReason): Promise<void>;
  discard(): void;
  pause(): void;
  resume(): void;
  state(): RecordingState;
}

export type RecordingState = 'recording' | 'paused' | 'stopping';
export const RECORDING_SAVED_SECONDS = 300;
export const RECORDING_MEMORY_SECONDS = 60;
export const RECORDING_SAVED_BYTES = 50 * 1024 * 1024;
export const RECORDING_MEMORY_BYTES = 16 * 1024 * 1024;

interface ActiveRecording extends RecordingHandle { stopping?: Promise<void>; }
const active = new WeakMap<BrowserOperationContext, ActiveRecording>();

/** Called after the server atomically admits this notebook's one recorder. */
export function registerRecordingHandle(context: BrowserOperationContext, handle: RecordingHandle): void {
  if (active.has(context)) throw new BrowserMediaError('busy', 'A recording is already active in this notebook.');
  active.set(context, handle);
}

export function recordingHandle(context: BrowserOperationContext, operationId: string): RecordingHandle {
  const handle = active.get(context);
  if (!handle || handle.operationId !== operationId)
    throw new BrowserMediaError('stale_target', 'Recording is unavailable.');
  return handle;
}

/** Server-retained recorder result, usable for repeat Stop after bytes are released. */
export function isCompletedRecording(status: BrowserOperationStatus, operationId: string): boolean {
  const result = status.result;
  return status.operation_id === operationId && status.status === 'completed' &&
    result?.recording === true && typeof result.source_id === 'string' && !!result.source_id &&
    typeof result.mime_type === 'string' && /^(audio|video)\//.test(result.mime_type) &&
    typeof result.audio === 'boolean' && typeof result.video === 'boolean' &&
    typeof result.max_duration_seconds === 'number';
}

export function activeRecordingForSource(context: BrowserOperationContext, sourceId: string): RecordingHandle | null {
  const handle = active.get(context);
  return handle?.sourceId === sourceId ? handle : null;
}

export async function stopRecordingHandle(context: BrowserOperationContext, operationId: string,
  reason: RecordingStopReason): Promise<void> {
  const handle = recordingHandle(context, operationId) as ActiveRecording;
  if (!handle.stopping) handle.stopping = handle.finalize(reason).finally(() => {
    if (active.get(context) === handle) active.delete(context);
  });
  try { await handle.stopping; }
  catch (error) {
    try {
      await context.transition(operationId, 'failed', undefined, {
        code: error instanceof BrowserMediaError ? error.code : 'unsupported',
        message: error instanceof Error ? error.message.slice(0, 300) : 'Recording failed'
      });
    } catch { /* cancellation or owner loss already ended the operation */ }
    throw error;
  }
}

export function discardRecordingHandle(context: BrowserOperationContext, operationId: string): void {
  const handle = active.get(context);
  if (!handle || handle.operationId !== operationId) return;
  active.delete(context);
  handle.discard();
}

/** Families call this from registerSource(...).onEnded, including canvas invalidation. */
export async function recordingSourceEnded(context: BrowserOperationContext, sourceId: string,
  reason: 'source_ended' | 'cancelled', cleanup?: () => void): Promise<void> {
  try {
    const handle = active.get(context);
    if (!handle || handle.sourceId !== sourceId) return;
    if (reason === 'cancelled') discardRecordingHandle(context, handle.operationId);
    else await stopRecordingHandle(context, handle.operationId, 'source_ended');
  } finally { cleanup?.(); }
}

function recorderMime(hasVideo: boolean, hasAudio: boolean): string | undefined {
  if (typeof MediaRecorder === 'undefined')
    throw new BrowserMediaError('unsupported', 'This browser does not support media recording.');
  const candidates = hasVideo ? [
    hasAudio ? 'video/webm;codecs=vp9,opus' : 'video/webm;codecs=vp9',
    hasAudio ? 'video/webm;codecs=vp8,opus' : 'video/webm;codecs=vp8',
    hasAudio ? 'video/mp4;codecs=avc1.42E01E,mp4a.40.2' : 'video/mp4;codecs=avc1.42E01E',
    'video/webm', 'video/mp4'
  ] : ['audio/webm;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/ogg;codecs=opus',
    'audio/webm', 'audio/mp4', 'audio/ogg'];
  return candidates.find(candidate => MediaRecorder.isTypeSupported?.(candidate));
}

function supportedMime(mime: string, hasVideo: boolean): boolean {
  const type = mime.split(';', 1)[0].toLowerCase();
  return hasVideo ? ['video/webm', 'video/mp4'].includes(type) :
    ['audio/webm', 'audio/mp4', 'audio/ogg'].includes(type);
}

/** Start the one real MediaRecorder, after server admission and source validation. */
export async function startRecordedOperation(context: BrowserOperationContext,
  operation: BrowserOperationStatus, source: BrowserSource, saveTo: string | null, duration: number): Promise<void> {
  if (source.state !== 'live' || source.tracks.some(track => track.readyState !== 'live'))
    throw new BrowserMediaError('source_stopped', 'The selected source stopped.');
  if (!Number.isInteger(duration) || duration < 1 || duration > (saveTo === null ? RECORDING_MEMORY_SECONDS : RECORDING_SAVED_SECONDS))
    throw new BrowserMediaError('limit_exceeded', 'Recording duration exceeds the selected destination limit.');
  const video = source.tracks.some(track => track.kind === 'video');
  const audio = source.tracks.some(track => track.kind === 'audio');
  if (!video && !audio) throw new BrowserMediaError('source_stopped', 'The source has no usable tracks.');
  const stream = new MediaStream(source.tracks);
  const preferred = recorderMime(video, audio);
  let recorder: MediaRecorder;
  try { recorder = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined); }
  catch { throw new BrowserMediaError('unsupported', 'This browser cannot encode the selected tracks.'); }
  let mime = recorder.mimeType || preferred || '';
  const validateMime = (): void => {
    if (!supportedMime(mime, video))
      throw new BrowserMediaError('unsupported', 'The browser did not provide a supported recording format.');
    if (saveTo !== null && saveTo !== 'auto') {
      const extension = saveTo.slice(saveTo.lastIndexOf('.')).toLowerCase();
      const valid = mime.startsWith('video/webm') ? ['.webm'] :
        mime.startsWith('audio/webm') ? ['.weba', '.webm'] :
          mime.startsWith('video/mp4') ? ['.mp4'] : mime.startsWith('audio/mp4') ? ['.m4a', '.mp4'] : ['.ogg'];
      if (!valid.includes(extension))
        throw new BrowserMediaError('invalid_argument', `Recording destination must end in ${valid.join(' or ')}.`);
    }
  };
  if (mime) validateMime();
  await context.claimRecording(operation.operation_id);
  let signal: AbortSignal;
  try { signal = context.operationSignal(operation.operation_id); }
  catch { throw new BrowserMediaError('cancelled', 'Recording ended during admission.'); }
  if (signal.aborted || !context.isCurrent())
    throw new BrowserMediaError('cancelled', 'Recording ended during admission.');
  const admitted = await context.status(operation.operation_id);
  if (admitted.status !== 'running' || signal.aborted || !context.isCurrent())
    throw new BrowserMediaError('cancelled', 'Recording ended during admission.');
  if (source.state !== 'live' || source.tracks.some(track => track.readyState !== 'live'))
    throw new BrowserMediaError('source_stopped', 'The source ended during recorder admission.');
  const maxBytes = saveTo === null ? RECORDING_MEMORY_BYTES : RECORDING_SAVED_BYTES;
  const pieces: Blob[] = [];
  let byteCount = 0;
  let discarded = false;
  let oversized = false;
  let stopRequested = false;
  let stopReason: RecordingStopReason = 'user';
  const started = performance.now();
  let timer: number | undefined;
  let finish!: () => void;
  let fail!: (error: Error) => void;
  const stopped = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
  const clear = (): void => { if (timer !== undefined) window.clearTimeout(timer); };
  const handle: RecordingHandle = {
    operationId: operation.operation_id, sourceId: source.sourceId,
    state: () => recorder.state === 'paused' ? 'paused' : recorder.state === 'recording' ? 'recording' : 'stopping',
    pause: () => {
      if (recorder.state === 'recording') recorder.pause();
      else if (recorder.state !== 'paused') throw new BrowserMediaError('stale_target', 'Recording has ended.');
    },
    resume: () => {
      if (recorder.state === 'paused') recorder.resume();
      else if (recorder.state !== 'recording') throw new BrowserMediaError('stale_target', 'Recording has ended.');
    },
    discard: () => {
      discarded = true;
      stopRequested = true;
      clear();
      pieces.length = 0;
      if (recorder.state !== 'inactive') recorder.stop();
    },
    finalize: async reason => {
      stopReason = reason;
      stopRequested = true;
      clear();
      if (recorder.state !== 'inactive') recorder.stop();
      let watchdog: number | undefined;
      try {
        await Promise.race([stopped, new Promise<void>((_resolve, reject) => {
          watchdog = window.setTimeout(() => reject(new BrowserMediaError('timeout',
            'Browser recorder did not flush its final data.')), 5000);
        })]);
      } finally { if (watchdog !== undefined) window.clearTimeout(watchdog); }
      if (discarded || context.operationSignal(operation.operation_id).aborted)
        throw new BrowserMediaError('cancelled', 'Recording was cancelled.');
      if (oversized || byteCount === 0)
        throw new BrowserMediaError(oversized ? 'limit_exceeded' : 'unsupported',
          oversized ? 'Recording exceeded its encoded size limit.' : 'Recorder produced no media.');
      const blob = new Blob(pieces, { type: mime });
      const data = new Uint8Array(await blob.arrayBuffer());
      if (data.byteLength > maxBytes) throw new BrowserMediaError('limit_exceeded', 'Recording exceeded its encoded size limit.');
      const digest = await sha256Bytes(data);
      const durationSeconds = Math.min(duration, Math.max(0, (performance.now() - started) / 1000));
      if (saveTo !== null) await context.transition(operation.operation_id, 'saving');
      await context.upload(operation.operation_id, data, mime, digest,
        { duration_seconds: durationSeconds, stop_reason: stopReason }, saveTo);
      pieces.length = 0;
    }
  };
  recorder.ondataavailable = event => {
    if (discarded || !event.data.size) return;
    byteCount += event.data.size;
    if (byteCount > maxBytes) oversized = true;
    else pieces.push(event.data);
    if (byteCount >= maxBytes) queueMicrotask(() => {
      void stopRecordingHandle(context, operation.operation_id, 'size').catch(() => undefined);
    });
  };
  const unexpectedStop = (message: string): void => {
    fail(new BrowserMediaError('unsupported', message));
    void stopRecordingHandle(context, operation.operation_id, 'user').catch(() => undefined);
  };
  recorder.onerror = () => unexpectedStop('Browser media encoding failed.');
  recorder.onstop = () => {
    if (stopRequested) finish();
    else unexpectedStop('Browser recorder stopped before the requested limit or Stop.');
  };
  try {
    registerRecordingHandle(context, handle);
    context.addOperationCleanup(operation.operation_id, () => {
      if (signal.aborted) discardRecordingHandle(context, operation.operation_id);
    });
    try { recorder.start(1000); mime = recorder.mimeType || mime; validateMime(); }
    catch (error) {
      if (error instanceof BrowserMediaError) throw error;
      throw new BrowserMediaError('unsupported', 'This browser could not start recording.');
    }
    await context.transition(operation.operation_id, 'running', { recording: true, source_id: source.sourceId,
      mime_type: mime, audio, video, max_duration_seconds: duration });
    timer = window.setTimeout(() => {
      void stopRecordingHandle(context, operation.operation_id, 'duration').catch(() => undefined);
    }, Math.max(0, duration * 1000 - (performance.now() - started)));
  } catch (error) { discardRecordingHandle(context, operation.operation_id); throw error; }
}
