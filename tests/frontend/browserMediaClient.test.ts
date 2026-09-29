import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserOperationContext, registerBrowserOperation } from '../../src/browserMediaClient';

function panelFixture() {
  const signal = { connect() { /* no-op */ }, disconnect() { /* no-op */ } };
  const kernel = {};
  const model = { cells: { length: 1, get: () => ({ id: 'cell' }) } };
  const panel = { isDisposed: false, disposed: signal,
    content: { model, modelChanged: signal },
    sessionContext: { session: { id: 'old-session', kernel }, kernelChanged: signal } };
  return { panel, kernel, model };
}

function browserGlobals(fetcher: typeof fetch): () => void {
  const oldWindow = globalThis.window;
  const oldDocument = globalThis.document;
  const oldFetch = globalThis.fetch;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    location: { origin: 'http://localhost:8897' },
    addEventListener() { /* no-op */ }, removeEventListener() { /* no-op */ },
    setInterval, clearInterval
  } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { cookie: '' } });
  globalThis.fetch = fetcher;
  return () => {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: oldWindow });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: oldDocument });
    globalThis.fetch = oldFetch;
  };
}

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
}

test('dispose revokes the original owner after notebook identity changes', async () => {
  const { panel, kernel } = panelFixture();
  let close: { body: Record<string, string>; secret: string | null } | undefined;
  const restore = browserGlobals(async (input, init) => {
    const command = String(input).split('/').pop();
    if (command === 'owner') return response({ owner_secret: 'server-secret' });
    if (command === 'close') {
      close = { body: JSON.parse(String(init?.body)), secret: new Headers(init?.headers).get('X-NBInlineAI-Owner') };
      return response({ closed: true });
    }
    throw new Error(`Unexpected ${command}`);
  });
  try {
    const context = new BrowserOperationContext(panel as never, kernel as never);
    await context.ready();
    panel.sessionContext.session.id = 'replacement-session';
    panel.sessionContext.session.kernel = {};
    panel.content.model = {} as typeof panel.content.model;
    panel.isDisposed = true;
    await context.dispose();
    assert.equal(close?.body.session_id, 'old-session');
    assert.equal(close?.secret, 'server-secret');
    assert.ok(close?.body.client_id && close?.body.model_id);
  } finally { restore(); }
});

test('dispatch stays single-flight past five minutes and rejects an old running create reply', async () => {
  const { panel, kernel } = panelFixture();
  const operationId = 'server-operation';
  let serverStatus = 'running';
  let runs = 0;
  const name = 'fixture_long_dispatch';
  registerBrowserOperation(name, async () => { runs++; await new Promise<void>(() => undefined); },
    () => ({ available: true }));
  const restore = browserGlobals(async input => {
    const command = String(input).split('/').pop();
    if (command === 'owner') return response({ owner_secret: 'server-secret' });
    if (command === 'create') return response({ operation_id: operationId, status: 'running' });
    if (command === 'status') return response({ operation_id: operationId, status: serverStatus });
    if (command === 'close') return response({ closed: true });
    throw new Error(`Unexpected ${command}`);
  });
  const realNow = Date.now;
  try {
    const context = new BrowserOperationContext(panel as never, kernel as never);
    const request = { request_id: 'same', name, arguments: {} };
    assert.equal((await context.start(request)).status, 'running');
    Date.now = () => realNow() + 6 * 60_000;
    const retries = await Promise.all([context.start(request), context.start(request)]);
    assert.ok(retries.every(item => item.operation_id === operationId));
    assert.equal(runs, 1);
    serverStatus = 'completed';
    context.emit({ operation_id: operationId, status: 'completed' });
    Date.now = () => realNow() + 12 * 60_000;
    assert.equal((await context.start(request)).status, 'completed');
    assert.equal(runs, 1);
    await context.dispose();
  } finally { Date.now = realNow; restore(); }
});

test('registered permission operation creates a real waiting_for_user state', async () => {
  const { panel, kernel } = panelFixture();
  let requestedWaiting: unknown;
  let handlerState = '';
  const name = 'fixture_permission_wait';
  registerBrowserOperation(name, async (_context, _request, operation) => {
    handlerState = operation.status;
  }, () => ({ available: true }), { waitingForUser: true });
  const restore = browserGlobals(async (input, init) => {
    const command = String(input).split('/').pop();
    if (command === 'owner') return response({ owner_secret: 'server-secret' });
    if (command === 'create') {
      requestedWaiting = JSON.parse(String(init?.body)).waiting;
      return response({ operation_id: 'waiting-operation', status: 'waiting_for_user' });
    }
    if (command === 'status') return response({ operation_id: 'waiting-operation', status: 'waiting_for_user' });
    if (command === 'close') return response({ closed: true });
    throw new Error(`Unexpected ${command}`);
  });
  try {
    const context = new BrowserOperationContext(panel as never, kernel as never);
    const started = await context.start({ request_id: 'permission', name, arguments: {} });
    assert.equal(requestedWaiting, true);
    assert.equal(started.status, 'waiting_for_user');
    assert.equal(handlerState, 'waiting_for_user');
    await context.dispose();
  } finally { restore(); }
});

test('stopped screen source remains identifiable for idempotent default Stop', async () => {
  const { panel, kernel } = panelFixture();
  const restore = browserGlobals(async input => {
    const command = String(input).split('/').pop();
    if (command === 'owner') return response({ owner_secret: 'server-secret' });
    if (command === 'close') return response({ closed: true });
    throw new Error(`Unexpected ${command}`);
  });
  try {
    const context = new BrowserOperationContext(panel as never, kernel as never);
    const track = { kind: 'video', readyState: 'live', stop() { this.readyState = 'ended'; },
      addEventListener() { /* test track */ }, removeEventListener() { /* test track */ } };
    const source = context.registerSource({ kind: 'screen', tracks: [track as never],
      actions: ['capture'], onEnded: () => undefined });
    assert.equal(context.uniqueStoppedSourceId('screen'), null);
    await context.endSource(source.sourceId, 'source_ended');
    assert.equal(context.uniqueStoppedSourceId('screen'), source.sourceId);
    assert.equal(context.sourceWasStopped(source.sourceId, 'screen'), true);
    await context.endSource(source.sourceId, 'source_ended');
    await context.dispose();
  } finally { restore(); }
});

test('exact memory and saved-file fetches pass cancellation to HTTP transport', async () => {
  const { panel, kernel } = panelFixture();
  const observed: Array<{ command: string; signal: AbortSignal | null | undefined }> = [];
  const restore = browserGlobals(async (input, init) => {
    const command = String(input).split('/').pop() ?? '';
    if (command === 'owner') return response({ owner_secret: 'server-secret' });
    if (command === 'close') return response({ closed: true });
    observed.push({ command, signal: init?.signal });
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true });
    });
  });
  try {
    const context = new BrowserOperationContext(panel as never, kernel as never);
    for (const reference of [{ media_id: 'owned' }, { path: 'clip.png', sha256: 'a'.repeat(64) }]) {
      const controller = new AbortController();
      const pending = context.fetchReference(reference, controller.signal);
      await new Promise(resolve => setTimeout(resolve, 0));
      controller.abort();
      await assert.rejects(pending, { name: 'AbortError' });
    }
    assert.deepEqual(observed.map(item => item.command), ['owned', 'browser-media-file']);
    assert.ok(observed.every(item => item.signal?.aborted));
    await context.dispose();
  } finally { restore(); }
});
