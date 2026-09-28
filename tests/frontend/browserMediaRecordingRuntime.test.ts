import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserOperationContext, BrowserSource } from '../../src/browserMediaClient';
import { startRecordedOperation, stopRecordingHandle } from '../../src/browserMediaRecorder';

test('the shared recorder claims once and uploads actual MIME with a user stop reason', async () => {
  const oldStream = globalThis.MediaStream;
  const oldRecorder = globalThis.MediaRecorder;
  const oldWindow = globalThis.window;
  class Stream {
    constructor(readonly tracks: unknown[]) { /* test stream */ }
  }
  class Recorder {
    static preferWebm = true;
    static isTypeSupported(mime: string): boolean { return Recorder.preferWebm && mime === 'audio/webm;codecs=opus'; }
    mimeType = Recorder.preferWebm ? 'audio/webm;codecs=opus' : '';
    state = 'inactive';
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onerror: (() => void) | null = null;
    onstop: (() => void) | null = null;
    constructor(_stream: unknown, _options: unknown) { /* test recorder */ }
    start(): void { this.state = 'recording'; if (!Recorder.preferWebm) this.mimeType = 'audio/mp4'; }
    pause(): void { this.state = 'paused'; }
    resume(): void { this.state = 'recording'; }
    stop(): void {
      this.state = 'inactive';
      this.ondataavailable?.({ data: new Blob([Recorder.preferWebm ?
        new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1]) :
        new Uint8Array([0, 0, 0, 12, 0x66, 0x74, 0x79, 0x70, 1, 2, 3, 4])]) });
      this.onstop?.();
    }
  }
  Object.defineProperty(globalThis, 'MediaStream', { configurable: true, value: Stream });
  Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: Recorder });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { setTimeout, clearTimeout } });
  const calls: Array<[string, ...unknown[]]> = [];
  const abort = new AbortController();
  const context = {
    claimRecording: async (id: string) => { calls.push(['claim', id]); },
    transition: async (id: string, state: string, result: unknown) => { calls.push(['transition', id, state, result]); },
    upload: async (id: string, data: Uint8Array, mime: string, _hash: string,
      metadata: unknown, destination: unknown) => { calls.push(['upload', id, data.length, mime, metadata, destination]); },
    operationSignal: () => abort.signal,
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
    Recorder.preferWebm = false;
    await startRecordedOperation(context, { operation_id: 'default-encoded', status: 'running' },
      source, 'voice.m4a', 30);
    await stopRecordingHandle(context, 'default-encoded', 'duration');
    assert.equal(calls.at(-1)?.[3], 'audio/mp4');
    assert.equal((calls.at(-1)?.[4] as { stop_reason: string }).stop_reason, 'duration');
  } finally {
    Object.defineProperty(globalThis, 'MediaStream', { configurable: true, value: oldStream });
    Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: oldRecorder });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: oldWindow });
  }
});
