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
export interface BrowserOperationOptions { waitingForUser?: boolean; }

const handlers = new Map<string, { handler: BrowserOperationHandler; capability: () => BrowserCapabilityFact;
  options: BrowserOperationOptions }>();
const controlNames = new Set(['browser_capabilities', 'operation_status', 'cancel_operation',
  'save_media', 'release_media']);
/** Register one family operation without changing shared dispatch code. */
export function registerBrowserOperation(name: string, handler: BrowserOperationHandler,
  capability: () => BrowserCapabilityFact, options: BrowserOperationOptions = {}): void {
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(name) || controlNames.has(name) || handlers.has(name) || handlers.size >= 43)
    throw new Error('Invalid, duplicate, or excessive browser operation');
  handlers.set(name, { handler, capability, options });
}
export function browserCapabilityFacts(fileMediaSupported: boolean): ReturnType<typeof boundedCapabilityFacts> {
  const controls: Array<[string, BrowserCapabilityFact]> = [
    ['browser_capabilities', { available: true }], ['operation_status', { available: true }],
    ['cancel_operation', { available: true }],
    ['save_media', { available: fileMediaSupported,
      ...(!fileMediaSupported ? { reason: 'Server filesystem cannot safely save media' } : {}) }],
    ['release_media', { available: true }]
  ];
  return boundedCapabilityFacts([...controls, ...Array.from(handlers, ([name, entry]) => [name, entry.capability()] as [string, BrowserCapabilityFact])]);
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
  private fileMediaAvailable = false;
  private readyPromise: Promise<void> | undefined;
  private readonly controllers = new Map<string, AbortController>();
  private readonly dispatched = new Map<string, { terminalAt?: number }>();
  private readonly releaseFlights = new Map<string, { promise: Promise<BrowserOperationStatus>; created: number }>();
  private readonly operationCleanup = new Map<string, Set<() => void>>();
  private readonly mediaCleanup = new Map<string, Set<() => void>>();
  private readonly sources = new Map<string, BrowserSource>();
  private readonly sourceListeners = new Map<string, Array<[MediaStreamTrack, () => void]>>();
  private readonly onDispose = new Set<() => void>();
  private readonly listeners = new Set<(operation: BrowserOperationStatus) => void>();
  private lease: number | undefined;
  private disposed = false;
  private readonly targetChanged = (): void => { void this.dispose(); };

  constructor(readonly panel: NotebookPanel, readonly kernel: Kernel.IKernelConnection) {
    panel.disposed.connect(this.targetChanged);
    panel.sessionContext.kernelChanged.connect(this.targetChanged);
    panel.content.modelChanged.connect(this.targetChanged);
    window.addEventListener('pagehide', this.targetChanged);
  }

  private identity(): Record<string, string> {
    if (this.disposed || this.panel.isDisposed || this.panel.sessionContext.session?.kernel !== this.kernel ||
        this.panel.sessionContext.session?.id !== this.originalSessionId ||
        this.panel.content.model !== this.model || !this.model)
      throw new BrowserMediaError('stale_target', 'The originating notebook or kernel changed.');
    const sessionId = this.panel.sessionContext.session?.id;
    if (!sessionId) throw new BrowserMediaError('stale_target', 'Notebook session is unavailable.');
    return { session_id: sessionId, client_id: this.clientId, model_id: this.modelId };
  }

  private async closeOwner(): Promise<void> {
    if (!this.ownerSecret || !this.originalSessionId) return;
    // Revocation names the originally minted owner even after Jupyter changes its
    // session or kernel. It must never use the replacement notebook's identity.
    await fetch(endpoint('nbinlineai/browser-media/close'), {
      method: 'POST', credentials: 'same-origin', headers: headers(this.ownerSecret),
      body: JSON.stringify({ session_id: this.originalSessionId,
        client_id: this.clientId, model_id: this.modelId })
    });
  }

  isCurrent(): boolean {
    try { this.identity(); return true; } catch { return false; }
  }

  private async command(command: string, body: Record<string, unknown>): Promise<any> {
    if (command !== 'owner' && command !== 'close' && !this.ownerSecret) await this.ready();
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
      this.fileMediaAvailable = result.file_media_supported === true;
      this.identity();
      this.lease = window.setInterval(() => { void this.command('heartbeat', {}).catch(() => { void this.dispose(); }); }, 30_000);
    })();
    try { await this.readyPromise; }
    catch (error) { this.readyPromise = undefined; throw error; }
  }

  /** An exact, volatile browser-owner proof for an attached question request. */
  async attachmentHeaders(): Promise<Headers> {
    await this.ready();
    const identity = this.identity();
    const requestHeaders = headers(this.ownerSecret);
    requestHeaders.set('X-NBInlineAI-Client', identity.client_id);
    requestHeaders.set('X-NBInlineAI-Model', identity.model_id);
    return requestHeaders;
  }

  async grantAttachment(operationId: string, media: { media_id: string } | { path: string; sha256: string },
    questionCellId: string, detail: 'auto' | 'low' | 'high'): Promise<Record<string, unknown>> {
    return this.command('grantattachment', { operation_id: operationId, media,
      question_cell_id: questionCellId, detail });
  }

  async create(request: BrowserOperationRequest, waiting = false): Promise<BrowserOperationStatus> {
    await this.ready();
    const state = await this.command('create', { ...request, waiting });
    if (!this.controllers.has(state.operation_id)) this.controllers.set(state.operation_id, new AbortController());
    return state;
  }
  fileMediaSupported(): boolean { return this.fileMediaAvailable; }
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
  private async save(reference: { media_id: string } | { path: string; sha256: string },
    saveTo = 'auto', requestId = randomId()): Promise<{ media: Record<string, unknown>; operation_id: string }> {
    const result = await this.command('save', { media: reference, save_to: saveTo, request_id: requestId });
    return result;
  }
  async startSave(reference: { media_id: string } | { path: string; sha256: string }, saveTo: string,
    requestId: string): Promise<{ initial: BrowserOperationStatus; completion: Promise<BrowserOperationStatus> }> {
    if (typeof saveTo !== 'string' || !saveTo)
      throw new BrowserMediaError('invalid_argument', 'save_to must name a destination');
    const created = await this.create({ request_id: requestId, name: 'save_media',
      arguments: { media: reference, save_to: saveTo } });
    if (['completed', 'failed', 'cancelled', 'expired'].includes(created.status)) {
      this.emit(created);
      return { initial: created, completion: Promise.resolve(created) };
    }
    const initial = created.status === 'saving' ? created : await this.transition(created.operation_id, 'saving');
    this.emit(initial);
    const saveJob = this.save(reference, saveTo, requestId)
      .then(() => this.status(created.operation_id))
      .catch(async error => {
        try {
          const current = await this.status(created.operation_id);
          if (['completed', 'failed', 'cancelled', 'expired'].includes(current.status)) return current;
          return await this.transition(created.operation_id, 'failed', undefined, {
            code: error instanceof BrowserMediaError ? error.code : 'stale_target',
            message: error instanceof Error ? error.message.slice(0, 300) : 'Media save failed'
          });
        }
        catch {
          return { operation_id: created.operation_id, status: 'failed' as const,
            error: { code: error instanceof BrowserMediaError ? error.code : 'stale_target',
              message: error instanceof Error ? error.message.slice(0, 300) : 'Media save failed' } };
        }
      });
    let timeoutId: number | undefined;
    const timeout = new Promise<BrowserOperationStatus>(resolve => {
      timeoutId = window.setTimeout(() => {
        void this.cancel(created.operation_id).then(resolve).catch(() => resolve({
          operation_id: created.operation_id, status: 'expired',
          error: { code: 'timeout', message: 'Media save did not finish before its delivery deadline.' }
        }));
      }, 8 * 60_000);
    });
    const completion = Promise.race([saveJob, timeout]).finally(() => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    });
    return { initial, completion };
  }
  async release(mediaId: string): Promise<void> {
    await this.command('release', { media_id: mediaId });
    this.mediaCleanup.get(mediaId)?.forEach(cleanup => cleanup());
    this.mediaCleanup.delete(mediaId);
  }
  async releaseOperation(request: BrowserOperationRequest): Promise<BrowserOperationStatus> {
    const created = await this.create(request);
    const oldest = Date.now() - 5 * 60_000;
    for (const [id, entry] of this.releaseFlights) if (entry.created < oldest) this.releaseFlights.delete(id);
    if (['completed', 'failed', 'cancelled', 'expired'].includes(created.status)) return created;
    let flight = this.releaseFlights.get(created.operation_id)?.promise;
    if (!flight) {
      flight = (async () => {
        try {
          await this.release(String(request.arguments.media_id));
          return await this.transition(created.operation_id, 'completed', { released: true });
        } catch (error) {
          const current = await this.status(created.operation_id);
          if (['completed', 'failed', 'cancelled', 'expired'].includes(current.status)) return current;
          return this.transition(created.operation_id, 'failed', undefined, {
            code: error instanceof BrowserMediaError ? error.code : 'unsupported',
            message: error instanceof Error ? error.message.slice(0, 300) : 'Media release failed'
          });
        }
      })();
      this.releaseFlights.set(created.operation_id, { promise: flight, created: Date.now() });
    }
    return flight;
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
      const dispatch = this.dispatched.get(status.operation_id);
      if (dispatch && dispatch.terminalAt === undefined) dispatch.terminalAt = Date.now();
      this.controllers.delete(status.operation_id);
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
    const status = await this.create(request, entry.options.waitingForUser === true);
    const oldest = Date.now() - 5 * 60_000;
    for (const [id, dispatch] of this.dispatched)
      if (dispatch.terminalAt !== undefined && dispatch.terminalAt < oldest) this.dispatched.delete(id);
    // A delayed create reply may describe an old running state. Read the current
    // server state before either returning it or dispatching an effect.
    const current = await this.status(status.operation_id);
    if (this.dispatched.has(status.operation_id) ||
        ['completed', 'failed', 'cancelled', 'expired'].includes(current.status)) return current;
    this.dispatched.set(status.operation_id, {});
    void entry.handler(this, request, current).catch(async error => {
      try { this.emit(await this.transition(current.operation_id, 'failed', undefined, {
        code: error instanceof BrowserMediaError ? error.code : 'unsupported',
        message: error instanceof Error ? error.message.slice(0, 400) : 'Browser operation failed'
      })); } catch { /* the owner may already have closed */ }
    });
    return current;
  }
  async dispose(): Promise<void> {
    if (this.disposed) return;
    const closing = (this.readyPromise ?? Promise.resolve()).catch(() => undefined)
      .then(() => this.closeOwner()).catch(() => undefined);
    this.disposed = true;
    this.panel.disposed.disconnect(this.targetChanged);
    this.panel.sessionContext.kernelChanged.disconnect(this.targetChanged);
    this.panel.content.modelChanged.disconnect(this.targetChanged);
    window.removeEventListener('pagehide', this.targetChanged);
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
