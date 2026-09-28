import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserOperationContext } from '../../src/browserMediaClient';
import { recordingSourceEnded, registerRecordingHandle, stopRecordingHandle } from '../../src/browserMediaRecorder';

test('source-ended and repeated Stop share one finalization; cancellation discards', async () => {
  const context = {} as BrowserOperationContext;
  const reasons: string[] = [];
  let finish!: () => void;
  registerRecordingHandle(context, { operationId: 'first', sourceId: 'canvas',
    finalize: async reason => { reasons.push(reason); await new Promise<void>(resolve => { finish = resolve; }); },
    discard: () => { reasons.push('discarded'); }, pause() {}, resume() {}, state: () => 'recording' });
  const ended = recordingSourceEnded(context, 'canvas', 'source_ended');
  const stopped = stopRecordingHandle(context, 'first', 'user');
  assert.deepEqual(reasons, ['source_ended']);
  finish();
  await Promise.all([ended, stopped]);
  await recordingSourceEnded(context, 'canvas', 'source_ended');
  assert.deepEqual(reasons, ['source_ended']);

  registerRecordingHandle(context, { operationId: 'second', sourceId: 'microphone',
    finalize: async reason => { reasons.push(reason); }, discard: () => { reasons.push('discarded'); },
    pause() {}, resume() {}, state: () => 'recording' });
  await recordingSourceEnded(context, 'microphone', 'cancelled');
  await recordingSourceEnded(context, 'microphone', 'source_ended');
  assert.deepEqual(reasons, ['source_ended', 'discarded']);
});
