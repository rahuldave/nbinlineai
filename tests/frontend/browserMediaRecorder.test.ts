import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserOperationContext } from '../../src/browserMediaClient';
import { isCompletedRecording, recordingSourceEnded, registerRecordingHandle, stopRecordingHandle } from '../../src/browserMediaRecorder';

test('repeat Stop recognizes a completed recording, not an unrelated completed operation', () => {
  const recording = { operation_id: 'recording', status: 'completed' as const, result: {
    recording: true, source_id: 'camera', mime_type: 'video/webm', audio: false, video: true,
    max_duration_seconds: 30 } };
  assert.equal(isCompletedRecording(recording, 'recording'), true);
  assert.equal(isCompletedRecording(recording, 'another-operation'), false);
  assert.equal(isCompletedRecording({ ...recording, result: {
    source_id: 'camera', mime_type: 'video/webm', audio: false, video: true,
    max_duration_seconds: 30 } }, 'recording'), false);
  assert.equal(isCompletedRecording({ operation_id: 'devices', status: 'completed', result: {
    devices: [], next_cursor: '', omitted_count: 0 } }, 'devices'), false);
});

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

test('source cleanup runs after a failed recorder flush and the next recorder can start', async () => {
  const transitions: string[] = [];
  const context = { transition: async (_id: string, state: string) => { transitions.push(state); } } as unknown as BrowserOperationContext;
  let cleanups = 0;
  registerRecordingHandle(context, { operationId: 'failed', sourceId: 'camera',
    finalize: async () => { throw new Error('flush failed'); }, discard() {},
    pause() {}, resume() {}, state: () => 'stopping' });
  await assert.rejects(recordingSourceEnded(context, 'camera', 'source_ended', () => { cleanups++; }),
    /flush failed/);
  assert.equal(cleanups, 1);
  assert.deepEqual(transitions, ['failed']);
  registerRecordingHandle(context, { operationId: 'next', sourceId: 'microphone',
    finalize: async () => undefined, discard() {}, pause() {}, resume() {}, state: () => 'recording' });
  await recordingSourceEnded(context, 'microphone', 'cancelled');
});
