import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectEncodedMedia, loadPlaybackMedia, reserveMediaWorkingPixels,
  sha256Bytes } from '../../src/browserMediaDecoder';

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  bytes.set([73, 72, 68, 82], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width); view.setUint32(20, height);
  return bytes;
}

test('exact byte inspection rejects disguised and oversized raster sources before decoding', () => {
  assert.deepEqual(inspectEncodedMedia(pngHeader(2, 3), 'image/png'),
    { kind: 'image', mimeType: 'image/png', width: 2, height: 3 });
  assert.throws(() => inspectEncodedMedia(pngHeader(2, 3), 'image/jpeg'),
    (error: any) => error.code === 'unsupported');
  assert.throws(() => inspectEncodedMedia(pngHeader(4097, 1), 'image/png'),
    (error: any) => error.code === 'limit_exceeded');
  assert.throws(() => inspectEncodedMedia(new TextEncoder().encode('<svg></svg>'), 'image/svg+xml'),
    (error: any) => error.code === 'unsupported');
  const wav = new Uint8Array(16);
  wav.set(new TextEncoder().encode('RIFF'), 0);
  wav.set(new TextEncoder().encode('WAVE'), 8);
  assert.deepEqual(inspectEncodedMedia(wav, 'audio/x-wav'),
    { kind: 'audio', mimeType: 'audio/x-wav', width: 0, height: 0 });
  assert.throws(() => inspectEncodedMedia(wav, 'application/json'),
    (error: any) => error.code === 'unsupported');
});

test('SHA-256 works without secure-origin WebCrypto and exact references reject changed bytes', async () => {
  const savedCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
  try {
    assert.equal(await sha256Bytes(new TextEncoder().encode('abc')),
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  } finally {
    if (savedCrypto) Object.defineProperty(globalThis, 'crypto', savedCrypto);
    else Reflect.deleteProperty(globalThis, 'crypto');
  }
  const bytes = pngHeader(2, 2);
  const context = { isCurrent: () => true, fetchReference: async () => ({
    data: bytes.buffer, mimeType: 'image/png', sha256: await sha256Bytes(bytes)
  }) };
  await assert.rejects(loadPlaybackMedia(context as never, { path: 'image.png', sha256: '0'.repeat(64) }),
    (error: any) => error.code === 'stale_target');
});

test('cancelled image decoding closes the bitmap and returns its pixel and preview budgets', async () => {
  const bytes = pngHeader(2, 2);
  const digest = await sha256Bytes(bytes);
  const context = { isCurrent: () => true, fetchReference: async () => ({
    data: bytes.buffer, mimeType: 'image/png', sha256: digest
  }) };
  const prior = globalThis.createImageBitmap;
  let complete: ((value: ImageBitmap) => void) | undefined;
  let closed = false;
  Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true,
    value: () => new Promise<ImageBitmap>(resolve => { complete = resolve; }) });
  try {
    const controller = new AbortController();
    const pending = loadPlaybackMedia(context as never, { media_id: 'image' },
      { signal: controller.signal, preview: true });
    while (!complete) await new Promise(resolve => setTimeout(resolve, 0));
    controller.abort();
    complete({ width: 2, height: 2, close: () => { closed = true; } } as ImageBitmap);
    await assert.rejects(pending, (error: any) => error.code === 'cancelled');
    assert.equal(closed, true);
    const release = reserveMediaWorkingPixels(context as never, 4096, 3906);
    release();
  } finally {
    Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: prior });
  }
});

test('working surfaces obey per-context and tab-wide pixel budgets', () => {
  const a = { isCurrent: () => true };
  const b = { isCurrent: () => true };
  const releases = [reserveMediaWorkingPixels(a as never, 4000, 4000),
    reserveMediaWorkingPixels(a as never, 4000, 4000),
    reserveMediaWorkingPixels(b as never, 4000, 4000),
    reserveMediaWorkingPixels(b as never, 4000, 4000)];
  try {
    assert.throws(() => reserveMediaWorkingPixels(a as never, 1, 1),
      (error: any) => error.code === 'limit_exceeded');
    assert.throws(() => reserveMediaWorkingPixels({} as never, 1, 1),
      (error: any) => error.code === 'limit_exceeded');
  } finally { releases.forEach(release => release()); }
  const release = reserveMediaWorkingPixels(a as never, 1, 1);
  release();
});

test('one verified video lease seeks a frame and aborts another seek without leaking its URL', async () => {
  const bytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]);
  const digest = await sha256Bytes(bytes);
  class Video extends EventTarget {
    src = '';
    controls = false;
    preload = '';
    duration = 2;
    videoWidth = 16;
    videoHeight = 16;
    readyState = 2;
    blockSeek = false;
    private position = 0;
    get currentTime(): number { return this.position; }
    set currentTime(value: number) {
      this.position = value;
      if (!this.blockSeek) queueMicrotask(() => this.dispatchEvent(new Event('seeked')));
    }
    canPlayType(mime: string): string { return mime === 'video/webm' ? 'maybe' : ''; }
    load(): void { if (this.src) queueMicrotask(() => this.dispatchEvent(new Event('loadeddata'))); }
    pause(): void { /* no playback in this decoder contract test */ }
    removeAttribute(name: string): void { if (name === 'src') this.src = ''; }
  }
  const video = new Video();
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalBitmap = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
  const originalCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
  const originalRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
  let revoked = 0;
  let closed = 0;
  Object.defineProperty(globalThis, 'document', { configurable: true,
    value: { createElement: () => video } });
  Object.defineProperty(globalThis, 'window', { configurable: true,
    value: { setTimeout, clearTimeout } });
  Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true,
    value: async () => ({ width: 16, height: 16, close: () => { closed++; } }) });
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:verified' });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => { revoked++; } });
  const context = { isCurrent: () => true, fetchReference: async () => ({
    data: bytes.buffer, mimeType: 'video/webm', sha256: digest
  }) };
  try {
    const lease = await loadPlaybackMedia(context as never, { media_id: 'clip' }, { preview: true });
    assert.equal(lease.kind, 'video');
    if (lease.kind !== 'video') return;
    const frame = await lease.frameAt(0.5);
    assert.equal(frame.actualSeconds, 0.5);
    assert.equal(frame.width, 16);
    frame.release();
    video.blockSeek = true;
    const controller = new AbortController();
    const pending = lease.frameAt(1, controller.signal);
    controller.abort();
    await assert.rejects(pending, (error: any) => error.code === 'cancelled');
    lease.release(); lease.release();
    assert.equal(closed, 1);
    assert.equal(revoked, 1);
  } finally {
    for (const [target, key, descriptor] of [
      [globalThis, 'document', originalDocument], [globalThis, 'window', originalWindow],
      [globalThis, 'createImageBitmap', originalBitmap],
      [URL, 'createObjectURL', originalCreate], [URL, 'revokeObjectURL', originalRevoke]
    ] as const) {
      if (descriptor) Object.defineProperty(target, key, descriptor);
      else Reflect.deleteProperty(target, key);
    }
  }
});
