/** One recorder implementation shared by device, display, and canvas sources. */
import { BrowserMediaError, BrowserOperationContext } from './browserMediaClient';

export type RecordingStopReason = 'user' | 'duration' | 'size' | 'source_ended';

export interface RecordingHandle {
  operationId: string;
  sourceId: string;
  finalize(reason: RecordingStopReason): Promise<void>;
  discard(): void;
}

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

export async function stopRecordingHandle(context: BrowserOperationContext, operationId: string,
  reason: RecordingStopReason): Promise<void> {
  const handle = recordingHandle(context, operationId) as ActiveRecording;
  if (!handle.stopping) handle.stopping = handle.finalize(reason).finally(() => {
    if (active.get(context) === handle) active.delete(context);
  });
  await handle.stopping;
}

export function discardRecordingHandle(context: BrowserOperationContext, operationId: string): void {
  const handle = active.get(context);
  if (!handle || handle.operationId !== operationId) return;
  active.delete(context);
  handle.discard();
}

/** Families call this from registerSource(...).onEnded, including canvas invalidation. */
export async function recordingSourceEnded(context: BrowserOperationContext, sourceId: string,
  reason: 'source_ended' | 'cancelled'): Promise<void> {
  const handle = active.get(context);
  if (!handle || handle.sourceId !== sourceId) return;
  if (reason === 'cancelled') discardRecordingHandle(context, handle.operationId);
  else await stopRecordingHandle(context, handle.operationId, 'source_ended');
}
