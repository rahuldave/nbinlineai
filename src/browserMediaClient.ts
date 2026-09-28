/** Owned browser operation transport. Family modules register handlers here. */
import { NotebookPanel } from '@jupyterlab/notebook';
import { Kernel } from '@jupyterlab/services';
import { ServerConnection } from '@jupyterlab/services';
import { boundedCapabilityFacts, BrowserCapabilityFact } from './browserMediaCapabilities';

export interface BrowserOperationRequest {
  request_id: string;
  name: string;
  arguments: Record<string, unknown>;
}
export interface BrowserOperationStatus {
  operation_id: string;
  status: 'waiting_for_user' | 'running' | 'paused' | 'saving' | 'completed' | 'cancelled' | 'failed' | 'expired';
  result?: Record<string, unknown>;
  media?: Record<string, unknown> | Array<Record<string, unknown>>;
  next_media_cursor?: number;
  error?: { code: string; message: string };
}
export type { BrowserCapabilityFact } from './browserMediaCapabilities';
export class BrowserMediaError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
export interface BrowserSource {
  sourceId: string;
  kind: 'camera' | 'microphone' | 'screen' | 'canvas';
  tracks: MediaStreamTrack[];
  actions: string[];
  state: 'live' | 'stopped';
  onEnded: (reason: 'source_ended' | 'cancelled') => void | Promise<void>;
}
export type BrowserOperationHandler = (context: BrowserOperationContext, request: BrowserOperationRequest,
  operation: BrowserOperationStatus) => Promise<void>;

const handlers = new Map<string, { handler: BrowserOperationHandler; capability: () => BrowserCapabilityFact }>();
/** Register one family operation without changing shared dispatch code. */
export function registerBrowserOperation(name: string, handler: BrowserOperationHandler,
  capability: () => BrowserCapabilityFact): void {
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(name) || handlers.has(name) || handlers.size >= 48)
    throw new Error('Invalid, duplicate, or excessive browser operation');
  handlers.set(name, { handler, capability });
}
export function browserCapabilityFacts(): ReturnType<typeof boundedCapabilityFacts> {
  return boundedCapabilityFacts(Array.from(handlers, ([name, entry]) => [name, entry.capability()]));
}
export function hasBrowserOperation(name: string): boolean { return handlers.has(name); }
export async function observedMediaPermissions(): Promise<Record<string, string>> {
  const states: Record<string, string> = {};
  if (!navigator.permissions?.query) return states;
  for (const name of ['camera', 'microphone'] as const) {
    try { states[name] = (await navigator.permissions.query({ name: name as PermissionName })).state; }
    catch { /* This browser does not expose that permission's passive state. */ }
  }
  return states;
}

const settings = ServerConnection.makeSettings();
function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}
function headers(secret?: string): Headers {
  const value = new Headers({ 'Content-Type': 'application/json' });
  if (settings.token) value.set('Authorization', `token ${settings.token}`);
  const xsrf = document.cookie.split('; ').find(item => item.startsWith('_xsrf='));
  if (xsrf) value.set('X-XSRFToken', decodeURIComponent(xsrf.slice(6)));
  if (secret) value.set('X-NBInlineAI-Owner', secret);
  return value;
}
function endpoint(path: string): string {
  return new URL(path, new URL(settings.baseUrl, window.location.origin)).toString();
}

/** Fixed notebook identity, credentials and resource hooks for one browser tab. */
export class BrowserOperationContext {
  private readonly model = this.panel.content.model;
  private readonly originalSessionId = this.panel.sessionContext.session?.id;
  private readonly clientId = randomId();
  private readonly modelId = randomId();
  private ownerSecret: string | undefined;
  private readyPromise: Promise<void> | undefined;
  private readonly controllers = new Map<string, AbortController>();
  private readonly dispatched = new Set<string>();
  private readonly operationCleanup = new Map<string, Set<() => void>>();
  private readonly mediaCleanup = new Map<string, Set<() => void>>();
  private readonly sources = new Map<string, BrowserSource>();
  private readonly sourceListeners = new Map<string, Array<[MediaStreamTrack, () => void]>>();
  private readonly onDispose = new Set<() => void>();
  private readonly listeners = new Set<(operation: BrowserOperationStatus) => void>();
  private lease: number | undefined;
  private disposed = false;

  constructor(readonly panel: NotebookPanel, readonly kernel: Kernel.IKernelConnection) {
    panel.disposed.connect(() => { void this.dispose(); });
    panel.sessionContext.kernelChanged.connect(() => { void this.dispose(); });
    panel.content.modelChanged.connect(() => { void this.dispose(); });
    window.addEventListener('pagehide', () => { void this.dispose(); }, { once: true });
  }

  private identity(): Record<string, string> {
    if (this.disposed || this.panel.isDisposed || this.panel.sessionContext.session?.kernel !== this.kernel ||
        this.panel.sessionContext.session?.id !== this.originalSessionId ||
        this.panel.content.model !== this.model || !this.model) throw new Error('The originating notebook or kernel changed.');
    const sessionId = this.panel.sessionContext.session?.id;
    if (!sessionId) throw new Error('Notebook session is unavailable.');
    return { session_id: sessionId, client_id: this.clientId, model_id: this.modelId };
  }

  private async command(command: string, body: Record<string, unknown>): Promise<any> {
    const response = await fetch(endpoint(`nbinlineai/browser-media/${command}`), {
      method: 'POST', credentials: 'same-origin', headers: headers(this.ownerSecret),
      body: JSON.stringify({ ...this.identity(), ...body })
    });
    const data = await response.json();
    if (!response.ok) throw new BrowserMediaError(data?.error?.code || 'unsupported',
      data?.error?.message || `Browser operation failed (${response.status}).`);
    if (command !== 'close') this.identity();
    return data;
  }

  async ready(): Promise<void> {
    if (this.ownerSecret) return;
    if (!this.readyPromise) this.readyPromise = (async () => {
      const result = await this.command('owner', {});
      this.ownerSecret = result.owner_secret;
      this.identity();
      this.lease = window.setInterval(() => { void this.command('heartbeat', {}).catch(() => { void this.dispose(); }); }, 30_000);
    })();
    try { await this.readyPromise; }
    catch (error) { this.readyPromise = undefined; throw error; }
  }

  async create(request: BrowserOperationRequest, waiting = false): Promise<BrowserOperationStatus> {
    await this.ready();
    const state = await this.command('create', { ...request, waiting });
    if (!this.controllers.has(state.operation_id)) this.controllers.set(state.operation_id, new AbortController());
    return state;
  }
  async status(operationId: string): Promise<BrowserOperationStatus> {
    const status = await this.command('status', { operation_id: operationId });
    this.emit(status);
    return status;
  }
  async mediaPage(operationId: string, cursor: number): Promise<{ media: Array<Record<string, unknown>>; next_media_cursor: number | null }> {
    return this.command('mediapage', { operation_id: operationId, cursor });
  }
  async beginBatch(operationId: string, total: number): Promise<BrowserOperationStatus> {
    const state = await this.command('beginbatch', { operation_id: operationId, total });
    this.emit(state);
    return state;
  }
  async finishBatch(operationId: string, saveTo: string | null = null): Promise<BrowserOperationStatus> {
    const state = await this.command('finishbatch', { operation_id: operationId, save_to: saveTo });
    this.emit(state);
    return state;
  }
  async transition(operationId: string, status: BrowserOperationStatus['status'],
    result?: Record<string, unknown>, error?: { code: string; message: string }): Promise<BrowserOperationStatus> {
    const updated = await this.command('transition', { operation_id: operationId, status, result, error });
    this.emit(updated);
    return updated;
  }
  async cancel(operationId: string): Promise<BrowserOperationStatus> {
    this.controllers.get(operationId)?.abort();
    this.operationCleanup.get(operationId)?.forEach(cleanup => { try { cleanup(); } catch { /* continue cancellation */ } });
    this.operationCleanup.delete(operationId);
    const updated = await this.command('cancel', { operation_id: operationId });
    this.emit(updated);
    return updated;
  }
  async save(reference: { media_id: string } | { path: string; sha256: string },
    saveTo = 'auto', requestId = randomId()): Promise<{ media: Record<string, unknown>; operation_id: string }> {
    const result = await this.command('save', { media: reference, save_to: saveTo, request_id: requestId });
    return result;
  }
  async release(mediaId: string): Promise<void> {
    await this.command('release', { media_id: mediaId });
    this.mediaCleanup.get(mediaId)?.forEach(cleanup => cleanup());
    this.mediaCleanup.delete(mediaId);
  }
  async upload(operationId: string, data: Uint8Array, mimeType: string, sha256: string,
    metadata: Record<string, unknown> = {}, saveTo: string | null = null,
    batchIndex?: number): Promise<BrowserOperationStatus> {
    await this.ready();
    if (data.byteLength > 50 * 1024 * 1024) throw new Error('Media exceeds 50 MiB.');
    const requestHeaders = headers(this.ownerSecret);
    const identity = this.identity();
    requestHeaders.set('Content-Type', mimeType);
    requestHeaders.set('X-NBInlineAI-Session', identity.session_id);
    requestHeaders.set('X-NBInlineAI-Client', identity.client_id);
    requestHeaders.set('X-NBInlineAI-Model', identity.model_id);
    requestHeaders.set('X-NBInlineAI-SHA256', sha256);
    requestHeaders.set('X-NBInlineAI-Metadata', JSON.stringify(metadata));
    requestHeaders.set('X-NBInlineAI-Save-To', JSON.stringify(saveTo));
    if (batchIndex !== undefined) requestHeaders.set('X-NBInlineAI-Batch-Index', String(batchIndex));
    const controller = this.controllers.get(operationId) ?? new AbortController();
    try {
      const response = await fetch(endpoint(`nbinlineai/browser-media-bytes/${encodeURIComponent(operationId)}`), {
        method: 'POST', credentials: 'same-origin', headers: requestHeaders, body: data as BodyInit,
        signal: controller.signal
      });
      const status = await response.json();
      if (!response.ok) throw new BrowserMediaError(status?.error?.code || 'unsupported',
        status?.error?.message || 'Media upload failed.');
      this.emit(status);
      return status;
    } finally { /* the operation owns cancellation until it reaches a terminal state */ }
  }
  async fetchMedia(mediaId: string): Promise<ArrayBuffer> {
    return (await this.mediaResponse(mediaId)).arrayBuffer();
  }
  private async mediaResponse(mediaId: string): Promise<Response> {
    await this.ready();
    const requestHeaders = headers(this.ownerSecret);
    const identity = this.identity();
    requestHeaders.set('X-NBInlineAI-Session', identity.session_id);
    requestHeaders.set('X-NBInlineAI-Client', identity.client_id);
    requestHeaders.set('X-NBInlineAI-Model', identity.model_id);
    const response = await fetch(endpoint(`nbinlineai/browser-media-bytes/${encodeURIComponent(mediaId)}`), {
      credentials: 'same-origin', headers: requestHeaders
    });
    if (!response.ok) throw new BrowserMediaError('stale_target', 'Media result expired or is unavailable.');
    return response;
  }
  async fetchReference(reference: { media_id: string } | { path: string; sha256: string }): Promise<{ data: ArrayBuffer; mimeType: string; sha256: string }> {
    await this.ready();
    if ('media_id' in reference) {
      const response = await this.mediaResponse(reference.media_id);
      return { data: await response.arrayBuffer(), mimeType: response.headers.get('Content-Type') || '',
        sha256: response.headers.get('X-NBInlineAI-SHA256') || '' };
    }
    const response = await fetch(endpoint('nbinlineai/browser-media-file'), {
      method: 'POST', credentials: 'same-origin', headers: headers(this.ownerSecret),
      body: JSON.stringify({ ...this.identity(), media: reference })
    });
    if (!response.ok) throw new BrowserMediaError('stale_target', 'Saved media changed or is unavailable.');
    return { data: await response.arrayBuffer(), mimeType: response.headers.get('Content-Type') || '',
      sha256: response.headers.get('X-NBInlineAI-SHA256') || '' };
  }
  onStatus(listener: (operation: BrowserOperationStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  emit(status: BrowserOperationStatus): void {
    if (['completed', 'failed', 'cancelled', 'expired'].includes(status.status)) {
      this.controllers.delete(status.operation_id);
      this.dispatched.delete(status.operation_id);
      this.operationCleanup.get(status.operation_id)?.forEach(cleanup => { try { cleanup(); } catch { /* continue cleanup */ } });
      this.operationCleanup.delete(status.operation_id);
    }
    this.listeners.forEach(listener => { try { listener(status); } catch { /* keep other status listeners live */ } });
  }
  operationSignal(operationId: string): AbortSignal {
    const controller = this.controllers.get(operationId);
    if (!controller) throw new Error('Operation is not active.');
    return controller.signal;
  }
  addOperationCleanup(operationId: string, cleanup: () => void): void {
    const cleanups = this.operationCleanup.get(operationId) ?? new Set<() => void>();
    cleanups.add(cleanup);
    this.operationCleanup.set(operationId, cleanups);
  }
  addMediaCleanup(mediaId: string, cleanup: () => void): void {
    const cleanups = this.mediaCleanup.get(mediaId) ?? new Set<() => void>();
    cleanups.add(cleanup);
    this.mediaCleanup.set(mediaId, cleanups);
  }
  registerSource(source: Omit<BrowserSource, 'sourceId' | 'state'>): BrowserSource {
    this.identity();
    if (this.sources.size >= 16) throw new Error('Too many live browser sources.');
    const registered: BrowserSource = { ...source, sourceId: randomId(), state: 'live' };
    this.sources.set(registered.sourceId, registered);
    const listeners: Array<[MediaStreamTrack, () => void]> = [];
    for (const track of registered.tracks) {
      const ended = (): void => { void this.endSource(registered.sourceId, 'source_ended'); };
      track.addEventListener('ended', ended, { once: true });
      listeners.push([track, ended]);
    }
    this.sourceListeners.set(registered.sourceId, listeners);
    return registered;
  }
  source(sourceId: string): BrowserSource {
    this.identity();
    const source = this.sources.get(sourceId);
    if (!source || source.state !== 'live') throw new Error('Source stopped or belongs to another notebook.');
    return source;
  }
  async endSource(sourceId: string, reason: 'source_ended' | 'cancelled'): Promise<void> {
    const source = this.sources.get(sourceId);
    if (!source || source.state === 'stopped') return;
    source.state = 'stopped';
    this.sources.delete(sourceId);
    this.sourceListeners.get(sourceId)?.forEach(([track, listener]) => track.removeEventListener('ended', listener));
    this.sourceListeners.delete(sourceId);
    source.tracks.forEach(track => track.stop());
    await source.onEnded(reason);
  }
  addCleanup(cleanup: () => void): void { this.onDispose.add(cleanup); }
  async start(request: BrowserOperationRequest): Promise<BrowserOperationStatus> {
    const entry = handlers.get(request.name);
    if (!entry) throw new Error(`Unsupported browser operation: ${request.name}`);
    if (!entry.capability().available) throw new Error(entry.capability().reason || 'Browser operation is unavailable.');
    const status = await this.create(request);
    this.emit(status);
    if (this.dispatched.has(status.operation_id) ||
        ['completed', 'failed', 'cancelled', 'expired'].includes(status.status)) return status;
    this.dispatched.add(status.operation_id);
    void entry.handler(this, request, status).catch(async error => {
      try { this.emit(await this.transition(status.operation_id, 'failed', undefined, {
        code: error instanceof BrowserMediaError ? error.code : 'unsupported',
        message: error instanceof Error ? error.message.slice(0, 400) : 'Browser operation failed'
      })); } catch { /* the owner may already have closed */ }
    });
    return status;
  }
  async dispose(): Promise<void> {
    if (this.disposed) return;
    const closing = this.ownerSecret ? this.command('close', {}).catch(() => undefined) : Promise.resolve();
    this.disposed = true;
    if (this.lease !== undefined) window.clearInterval(this.lease);
    this.controllers.forEach(controller => controller.abort());
    await Promise.allSettled(Array.from(this.sources, ([sourceId]) => this.endSource(sourceId, 'cancelled')));
    this.operationCleanup.forEach(cleanups => cleanups.forEach(cleanup => { try { cleanup(); } catch { /* continue teardown */ } }));
    this.operationCleanup.clear();
    this.mediaCleanup.forEach(cleanups => cleanups.forEach(cleanup => { try { cleanup(); } catch { /* continue teardown */ } }));
    this.mediaCleanup.clear();
    this.onDispose.forEach(cleanup => { try { cleanup(); } catch { /* continue teardown */ } });
    await closing;
    // The lease is the fallback if pagehide prevents a final authenticated request.
  }
}
