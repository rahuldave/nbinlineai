import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { BrowserOperationContext, BrowserSource } from '../../src/browserMediaClient';
import { recordingHandle, startRecordedOperation, stopRecordingHandle } from '../../src/browserMediaRecorder';

test('the shared recorder claims once and uploads actual MIME with a user stop reason', async () => {
  const oldStream = globalThis.MediaStream;
  const oldRecorder = globalThis.MediaRecorder;
  const oldWindow = globalThis.window;
  const oldCrypto = globalThis.crypto;
  class Stream {
    constructor(readonly tracks: unknown[]) { /* test stream */ }
  }
  class Recorder {
    static preferWebm = true;
    static emitFinal = true;
    static last: Recorder;
    static isTypeSupported(mime: string): boolean { return Recorder.preferWebm && mime === 'audio/webm;codecs=opus'; }
    mimeType = Recorder.preferWebm ? 'audio/webm;codecs=opus' : '';
    state = 'inactive';
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onerror: (() => void) | null = null;
    onstop: (() => void) | null = null;
    constructor(_stream: unknown, _options: unknown) { Recorder.last = this; }
    start(): void { this.state = 'recording'; if (!Recorder.preferWebm) this.mimeType = 'audio/mp4'; }
    pause(): void { this.state = 'paused'; }
    resume(): void { this.state = 'recording'; }
    stop(): void {
      this.state = 'inactive';
      if (Recorder.emitFinal) this.ondataavailable?.({ data: new Blob([Recorder.preferWebm ?
        new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1]) :
        new Uint8Array([0, 0, 0, 12, 0x66, 0x74, 0x79, 0x70, 1, 2, 3, 4])]) });
      this.onstop?.();
    }
  }
  Object.defineProperty(globalThis, 'MediaStream', { configurable: true, value: Stream });
  Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: Recorder });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { setTimeout, clearTimeout } });
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} });
  const calls: Array<[string, ...unknown[]]> = [];
  const hashes: string[] = [];
  const abort = new AbortController();
  const context = {
    claimRecording: async (id: string) => { calls.push(['claim', id]); },
    transition: async (id: string, state: string, result: unknown) => { calls.push(['transition', id, state, result]); },
    upload: async (id: string, data: Uint8Array, mime: string, hash: string,
      metadata: unknown, destination: unknown) => {
      hashes.push(hash);
      calls.push(['upload', id, data.length, mime, metadata, destination]);
    },
    operationSignal: () => abort.signal,
    isCurrent: () => true,
    status: async (id: string) => ({ operation_id: id, status: 'running' }),
    addOperationCleanup: () => undefined
  } as unknown as BrowserOperationContext;
  const source = { sourceId: 'microphone', state: 'live',
    tracks: [{ kind: 'audio', readyState: 'live' }] } as BrowserSource;
  try {
    await startRecordedOperation(context, { operation_id: 'recording', status: 'running' }, source, null, 30);
    await stopRecordingHandle(context, 'recording', 'user');
    assert.deepEqual(calls.map(call => call[0]), ['claim', 'transition', 'upload']);
    assert.equal(calls[1][3] && (calls[1][3] as { mime_type: string }).mime_type, 'audio/webm;codecs=opus');
    assert.equal(calls[2][3], 'audio/webm;codecs=opus');
    assert.equal((calls[2][4] as { stop_reason: string }).stop_reason, 'user');
    assert.equal(calls[2][5], null);
    assert.equal(hashes[0], createHash('sha256').update(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1])).digest('hex'));
    Recorder.preferWebm = false;
    await startRecordedOperation(context, { operation_id: 'default-encoded', status: 'running' },
      source, 'voice.m4a', 30);
    await stopRecordingHandle(context, 'default-encoded', 'duration');
    assert.equal(calls.at(-1)?.[3], 'audio/mp4');
    assert.equal((calls.at(-1)?.[4] as { stop_reason: string }).stop_reason, 'duration');
    assert.equal(hashes[1], createHash('sha256').update(
      new Uint8Array([0, 0, 0, 12, 0x66, 0x74, 0x79, 0x70, 1, 2, 3, 4])).digest('hex'));

    await startRecordedOperation(context, { operation_id: 'encoder-error', status: 'running' }, source, null, 30);
    Recorder.last.onerror?.();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.ok(calls.some(call => call[0] === 'transition' && call[1] === 'encoder-error' && call[2] === 'failed'));

    await startRecordedOperation(context, { operation_id: 'unexpected-stop', status: 'running' }, source, null, 30);
    Recorder.last.state = 'inactive';
    Recorder.last.onstop?.();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.ok(calls.some(call => call[0] === 'transition' && call[1] === 'unexpected-stop' && call[2] === 'failed'));

    let releaseClaim: (() => void) | undefined;
    let holdClaim = true;
    let signalAvailable = true;
    let raceController = new AbortController();
    const raceContext = {
      claimRecording: async () => { if (holdClaim) await new Promise<void>(resolve => { releaseClaim = resolve; }); },
      operationSignal: () => {
        if (!signalAvailable) throw new Error('Controller removed by cancellation');
        return raceController.signal;
      },
      status: async (id: string) => ({ operation_id: id, status: 'running' }),
      isCurrent: () => true, addOperationCleanup: () => undefined,
      transition: async () => undefined,
      upload: async () => undefined
    } as unknown as BrowserOperationContext;
    const cancelledStart = startRecordedOperation(raceContext,
      { operation_id: 'cancel-during-claim', status: 'running' }, source, null, 30);
    raceController.abort(); signalAvailable = false; releaseClaim?.();
    await assert.rejects(cancelledStart, /ended during admission/);
    holdClaim = false; signalAvailable = true; raceController = new AbortController();
    await startRecordedOperation(raceContext, { operation_id: 'after-cancel', status: 'running' }, source, null, 30);
    await stopRecordingHandle(raceContext, 'after-cancel', 'user');

    holdClaim = true;
    const endedStart = startRecordedOperation(raceContext,
      { operation_id: 'source-ends-during-claim', status: 'running' }, source, null, 30);
    source.state = 'stopped';
    (source.tracks[0] as { readyState: string }).readyState = 'ended';
    releaseClaim?.();
    await assert.rejects(endedStart, /source ended during recorder admission/);
    source.state = 'live';
    (source.tracks[0] as { readyState: string }).readyState = 'live';
    holdClaim = false;
    await startRecordedOperation(raceContext, { operation_id: 'after-ended-source', status: 'running' }, source, null, 30);
    await stopRecordingHandle(raceContext, 'after-ended-source', 'user');

    await startRecordedOperation(context, { operation_id: 'pause-resume', status: 'running' }, source, null, 30);
    recordingHandle(context, 'pause-resume').pause();
    assert.equal(recordingHandle(context, 'pause-resume').state(), 'paused');
    recordingHandle(context, 'pause-resume').resume();
    assert.equal(recordingHandle(context, 'pause-resume').state(), 'recording');
    await stopRecordingHandle(context, 'pause-resume', 'user');

    await startRecordedOperation(context, { operation_id: 'duration-limit', status: 'running' }, source, null, 1);
    recordingHandle(context, 'duration-limit').pause();
    await new Promise(resolve => setTimeout(resolve, 1100));
    assert.ok(calls.some(call => call[0] === 'upload' && call[1] === 'duration-limit' &&
      (call[4] as { stop_reason: string }).stop_reason === 'duration'));

    Recorder.emitFinal = false;
    await startRecordedOperation(context, { operation_id: 'size-limit', status: 'running' }, source, null, 30);
    Recorder.last.ondataavailable?.({ data: new Blob([new Uint8Array(16 * 1024 * 1024)]) });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.ok(calls.some(call => call[0] === 'upload' && call[1] === 'size-limit' &&
      (call[4] as { stop_reason: string }).stop_reason === 'size'));
  } finally {
    Object.defineProperty(globalThis, 'MediaStream', { configurable: true, value: oldStream });
    Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: oldRecorder });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: oldWindow });
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: oldCrypto });
  }
});
