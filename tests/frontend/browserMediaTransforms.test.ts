import { test } from 'node:test';
import assert from 'node:assert/strict';
import { annotateImage, cropImage, extractFrames } from '../../src/browserMediaTransforms';
import { reserveMediaWorkingPixels, sha256Bytes } from '../../src/browserMediaDecoder';

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  bytes.set([73, 72, 68, 82], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width); view.setUint32(20, height);
  return bytes;
}
function replace(target: object, key: string, value: unknown): () => void {
  const original = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, value });
  return () => {
    if (original) Object.defineProperty(target, key, original);
    else Reflect.deleteProperty(target, key);
  };
}

test('crop enforces source-pixel bounds, uploads a new PNG and releases surfaces', async () => {
  const source = pngHeader(4, 4);
  const output = pngHeader(2, 2);
  const digest = await sha256Bytes(source);
  const calls: Array<{ width: number; height: number; metadata: Record<string, unknown>; saveTo: string | null }> = [];
  let closed = 0;
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: (...args: unknown[]) => {
    assert.deepEqual(args.slice(1), [1, 1, 2, 2, 0, 0, 2, 2]);
  } }), toBlob: (callback: (blob: Blob) => void) => callback(new Blob([output as BlobPart])) };
  const undo = [replace(globalThis, 'document', { createElement: () => canvas }),
    replace(globalThis, 'createImageBitmap', async () => ({ width: 4, height: 4, close: () => { closed++; } }))];
  const signal = new AbortController().signal;
  const context = {
    isCurrent: () => true, operationSignal: () => signal,
    fetchReference: async () => ({ data: source.buffer, mimeType: 'image/png', sha256: digest }),
    upload: async (_id: string, _bytes: Uint8Array, _mime: string, _hash: string,
      metadata: Record<string, unknown>, saveTo: string | null) => {
      calls.push({ width: canvas.width, height: canvas.height, metadata, saveTo });
    }
  };
  try {
    await assert.rejects(cropImage(context as never, { name: 'crop_image', request_id: 'r',
      arguments: { media: { media_id: 'source' }, x: 3, y: 1, width: 2, height: 2 } },
    { operation_id: 'op', status: 'running' }), (error: any) => error.code === 'invalid_argument');
    await cropImage(context as never, { name: 'crop_image', request_id: 'r2',
      arguments: { media: { media_id: 'source' }, x: 1, y: 1, width: 2, height: 2, save_to: 'derived.png' } },
    { operation_id: 'op2', status: 'running' });
    assert.deepEqual(calls, [{ width: 2, height: 2,
      metadata: { source_sha256: digest, transform: 'crop_image' }, saveTo: 'derived.png' }]);
    assert.equal(closed, 2);
    const release = reserveMediaWorkingPixels(context as never, 4096, 3906);
    release();
  } finally { undo.reverse().forEach(restore => restore()); }
});

test('redaction uses opaque black pixels and refuses an out-of-bounds shape', async () => {
  const source = pngHeader(4, 4);
  const digest = await sha256Bytes(source);
  const marks: unknown[][] = [];
  let fillStyle = '';
  let alpha = 0;
  let uploads = 0;
  const drawing = {
    drawImage: () => undefined,
    set fillStyle(value: string) { fillStyle = value; },
    set globalAlpha(value: number) { alpha = value; },
    fillRect: (...args: unknown[]) => { marks.push(args); }
  };
  const canvas = { width: 0, height: 0, getContext: () => drawing,
    toBlob: (callback: (blob: Blob) => void) => callback(new Blob([pngHeader(4, 4) as BlobPart])) };
  const undo = [replace(globalThis, 'document', { createElement: () => canvas }),
    replace(globalThis, 'createImageBitmap', async () => ({ width: 4, height: 4, close: () => undefined }))];
  const context = { isCurrent: () => true, operationSignal: () => new AbortController().signal,
    fetchReference: async () => ({ data: source.buffer, mimeType: 'image/png', sha256: digest }),
    upload: async () => { uploads++; } };
  const base = { name: 'annotate_image', request_id: 'r', arguments: { media: { media_id: 'source' },
    annotations: [{ type: 'redaction', x: 1, y: 1, width: 2, height: 2 }] } };
  try {
    await annotateImage(context as never, base, { operation_id: 'op', status: 'running' });
    assert.equal(fillStyle, '#000000'); assert.equal(alpha, 1);
    assert.deepEqual(marks, [[1, 1, 2, 2]]); assert.equal(uploads, 1);
    await assert.rejects(annotateImage(context as never, { ...base, arguments: { ...base.arguments,
      annotations: [{ type: 'redaction', x: 3, y: 3, width: 2, height: 2 }] } },
    { operation_id: 'bad', status: 'running' }), (error: any) => error.code === 'invalid_argument');
    assert.equal(uploads, 1);
  } finally { undo.reverse().forEach(restore => restore()); }
});

test('one decoder lease uploads actual video timestamps and cancels a partial batch', async () => {
  const source = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]);
  const digest = await sha256Bytes(source);
  const output = pngHeader(2, 2);
  class Video extends EventTarget {
    src = ''; controls = false; preload = ''; duration = 2; videoWidth = 2; videoHeight = 2; readyState = 2;
    private position = 0;
    get currentTime(): number { return this.position; }
    set currentTime(value: number) { this.position = value + 0.01; queueMicrotask(() => this.dispatchEvent(new Event('seeked'))); }
    canPlayType(): string { return 'maybe'; }
    load(): void { if (this.src) queueMicrotask(() => this.dispatchEvent(new Event('loadeddata'))); }
    pause(): void { /* decoder does not play */ }
    removeAttribute(): void { this.src = ''; }
  }
  const video = new Video();
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: () => undefined }),
    toBlob: (callback: (blob: Blob) => void) => callback(new Blob([output as BlobPart])) };
  let revoked = 0;
  const undo = [replace(globalThis, 'document', { createElement: (kind: string) => kind === 'video' ? video : canvas }),
    replace(globalThis, 'window', { setTimeout, clearTimeout }),
    replace(globalThis, 'createImageBitmap', async () => ({ width: 2, height: 2, close: () => undefined })),
    replace(URL, 'createObjectURL', () => 'blob:source'),
    replace(URL, 'revokeObjectURL', () => { revoked++; })];
  const uploaded: Array<Record<string, unknown>> = [];
  let cancelled = 0; let finished = 0;
  const context = { isCurrent: () => true, operationSignal: () => new AbortController().signal,
    fetchReference: async () => ({ data: source.buffer, mimeType: 'video/webm', sha256: digest }),
    beginBatch: async () => undefined,
    upload: async (_id: string, _bytes: Uint8Array, _mime: string, _hash: string,
      metadata: Record<string, unknown>) => { uploaded.push(metadata); },
    finishBatch: async () => { finished++; }, cancel: async () => { cancelled++; } };
  const request = { name: 'extract_frames', request_id: 'r',
    arguments: { media: { media_id: 'video' }, timestamps: [0.5, 1], save_to: 'frames' } };
  try {
    await extractFrames(context as never, request, { operation_id: 'op', status: 'running' });
    assert.deepEqual(uploaded.map(part => part.actual_seconds), [0.51, 1.01]);
    assert.equal(finished, 1); assert.equal(cancelled, 0); assert.equal(revoked, 1);
    context.upload = async () => { throw new Error('upload failed'); };
    await assert.rejects(extractFrames(context as never, request, { operation_id: 'fail', status: 'running' }));
    assert.equal(cancelled, 1); assert.equal(revoked, 2);
  } finally { undo.reverse().forEach(restore => restore()); }
});
