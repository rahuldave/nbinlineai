import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserMediaError, BrowserOperationStatus } from '../../src/browserMediaClient';
import { BrowserMediaStatusModel } from '../../src/browserMediaStatusModel';

test('pending permission receipt refreshes to server expiry after the AI answer ends', async () => {
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    setInterval() { return 1; },
    clearInterval() { /* no-op */ }
  } });
  let listener: ((status: BrowserOperationStatus) => void) | undefined;
  let status: BrowserOperationStatus = { operation_id: 'camera', status: 'waiting_for_user' };
  const snapshots: BrowserOperationStatus[][] = [];
  const context = {
    onStatus(callback: (state: BrowserOperationStatus) => void) { listener = callback; return () => { listener = undefined; }; },
    async status() { listener?.(status); return status; },
    async cancel() { throw new Error('Cancel should not be needed after expiry'); }
  };
  try {
    const model = new BrowserMediaStatusModel(context, rows => snapshots.push(rows));
    listener?.(status);
    status = { operation_id: 'camera', status: 'expired', error: { code: 'timeout', message: 'Permission request timed out' } };
    await model.refresh();
    assert.equal(snapshots.at(-1)?.[0].status, 'expired');
    await model.stop('camera');
    model.dispose();
    assert.equal(listener, undefined);
  } finally { Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow }); }
});

test('Stop clears a retained row when its exact server operation was already removed', async () => {
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    setInterval() { return 1; }, clearInterval() { /* no-op */ }
  } });
  let listener: ((status: BrowserOperationStatus) => void) | undefined;
  const snapshots: BrowserOperationStatus[][] = [];
  let cancels = 0;
  const context = {
    onStatus(callback: (state: BrowserOperationStatus) => void) { listener = callback; return () => { listener = undefined; }; },
    async status() { throw new BrowserMediaError('stale_target', 'Operation is unavailable'); },
    async cancel() { cancels++; throw new BrowserMediaError('stale_target', 'Operation is unavailable'); }
  };
  try {
    const model = new BrowserMediaStatusModel(context, rows => snapshots.push(rows));
    listener?.({ operation_id: 'camera', status: 'waiting_for_user' });
    await model.stop('camera');
    assert.equal(cancels, 1);
    assert.equal(snapshots.at(-1)?.[0].status, 'expired');
    assert.match(snapshots.at(-1)?.[0].error?.message ?? '', /expired or its owner changed/);
    listener?.({ operation_id: 'camera', status: 'waiting_for_user' });
    assert.equal(snapshots.at(-1)?.[0].status, 'expired');
    await model.stop('camera');
    assert.equal(cancels, 1);
    model.dispose();
  } finally { Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow }); }
});
