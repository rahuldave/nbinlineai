import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CanvasRegistry } from '../../src/browserNotebookCanvas';
import { outputLedger } from '../../src/browserNotebookOutputs';

function signal() {
  const listeners = new Set<() => void>();
  return { connect: (listener: () => void) => { listeners.add(listener); },
    disconnect: (listener: () => void) => { listeners.delete(listener); },
    emit: () => listeners.forEach(listener => listener()) };
}

test('canvas ID binds one rendered HTML output node and invalidation ends its source', async () => {
  const oldObserver = globalThis.MutationObserver;
  let notify = () => undefined;
  Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: class {
    constructor(callback: () => void) { notify = callback; }
    observe() { /* passive observation */ }
    disconnect() { /* passive observation */ }
  } });
  const canvas = { width: 8, height: 8, isConnected: true };
  const html = { querySelectorAll: () => [canvas] };
  const outputNode = { isConnected: true, contains: (node: unknown) => node === canvas,
    querySelector: () => html, querySelectorAll: () => [canvas] };
  const output = { type: 'display_data', data: { 'text/html': '<canvas></canvas>' },
    trusted: true, changed: signal(), streamText: undefined };
  const outputChanged = signal();
  const outputs = { changed: outputChanged, length: 1, get: () => output };
  const code = { id: 'cell', type: 'code', outputs };
  const area = { model: outputs, widgets: [{ node: outputNode, isDisposed: false }],
    node: { contains: (node: unknown) => node === outputNode },
    rendermime: { preferredMimeType: () => 'text/html' } };
  const widget = { model: code, outputArea: area, node: { isConnected: true },
    isPlaceholder: () => false, isDisposed: false };
  const cells = { changed: signal(), length: 1, get: () => code };
  const ended: string[] = [];
  const context = { isCurrent: () => true, addCleanup: (_: () => void) => undefined,
    endSource: async (id: string) => { ended.push(id); },
    panel: { node: { contains: () => true }, content: { node: {}, widgets: [widget], model: { cells } } } };
  try {
    const ref = outputLedger(context as never).list('cell', '', 10).outputs[0];
    const registry = new CanvasRegistry(context as never);
    const listed = registry.list(ref, '', 10) as { available: boolean; canvases: Array<{ canvas_id: string }> };
    assert.equal(listed.available, true);
    assert.equal(listed.canvases.length, 1);
    const canvasRef = listed.canvases[0];
    assert.equal(registry.resolve(canvasRef as never).node, canvas);
    registry.trackSource(registry.resolve(canvasRef as never), 'video-source');
    canvas.isConnected = false;
    notify();
    assert.throws(() => registry.resolve(canvasRef as never), /changed/);
    assert.deepEqual(ended, ['video-source']);
    registry.dispose();
  } finally { Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: oldObserver }); }
});
