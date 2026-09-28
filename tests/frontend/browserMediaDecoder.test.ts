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
});

test('SHA-256 works without secure-origin WebCrypto and exact references reject changed bytes', async () => {
  assert.equal(await sha256Bytes(new TextEncoder().encode('abc')),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
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
