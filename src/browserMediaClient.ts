/** Owned browser operation transport. Family modules register handlers here. */
import { NotebookPanel } from '@jupyterlab/notebook';
import { Kernel } from '@jupyterlab/services';
import { ServerConnection } from '@jupyterlab/services';

export interface BrowserOperationRequest {
  request_id: string;
  name: string;
  arguments: Record<string, unknown>;
}
export interface BrowserOperationStatus {
  operation_id: string;
  status: 'waiting_for_user' | 'running' | 'paused' | 'saving' | 'completed' | 'cancelled' | 'failed' | 'expired';
  result?: Record<string, unknown>;
  media?: Record<string, unknown>;
  error?: { code: string; message: string };
}
export interface BrowserCapabilityFact { available: boolean; reason?: string; formats?: string[] }
export type BrowserOperationHandler = (context: BrowserOperationContext, request: BrowserOperationRequest,
  operation: BrowserOperationStatus) => Promise<void>;

const handlers = new Map<string, { handler: BrowserOperationHandler; capability: () => BrowserCapabilityFact }>();
/** Register one family operation without changing shared dispatch code. */
export function registerBrowserOperation(name: string, handler: BrowserOperationHandler,
  capability: () => BrowserCapabilityFact): void {
  if (!/^[a-z][a-z0-9_]{0,79}$/.test(name) || handlers.has(name)) throw new Error('Invalid or duplicate browser operation');
  handlers.set(name, { handler, capability });
}
export function browserCapabilityFacts(): Record<string, BrowserCapabilityFact> {
  return Object.fromEntries(Array.from(handlers, ([name, entry]) => [name, entry.capability()]));
}

const settings = ServerConnection.makeSettings();
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
  private readonly clientId = crypto.randomUUID();
  private readonly modelId = crypto.randomUUID();
  private ownerSecret: string | undefined;
  private readonly controllers = new Map<string, AbortController>();
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
        !this.panel.content.model) throw new Error('The originating notebook or kernel changed.');
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
    if (!response.ok) throw new Error(data?.error?.message || `Browser operation failed (${response.status}).`);
    return data;
  }

  async ready(): Promise<void> {
    if (this.ownerSecret) return;
    const result = await this.command('owner', {});
    this.ownerSecret = result.owner_secret;
    this.lease = window.setInterval(() => { void this.command('heartbeat', {}).catch(() => { void this.dispose(); }); }, 30_000);
  }

  async create(request: BrowserOperationRequest, waiting = false): Promise<BrowserOperationStatus> {
    await this.ready();
    return this.command('create', { ...request, waiting });
  }
  async status(operationId: string): Promise<BrowserOperationStatus> {
    return this.command('status', { operation_id: operationId });
  }
  async transition(operationId: string, status: BrowserOperationStatus['status'],
    result?: Record<string, unknown>, error?: { code: string; message: string }): Promise<BrowserOperationStatus> {
    return this.command('transition', { operation_id: operationId, status, result, error });
  }
  async cancel(operationId: string): Promise<BrowserOperationStatus> {
    this.controllers.get(operationId)?.abort();
    return this.command('cancel', { operation_id: operationId });
  }
  async save(mediaId: string, saveTo = 'auto'): Promise<Record<string, unknown>> {
    const result = await this.command('save', { media_id: mediaId, save_to: saveTo });
    return result.media;
  }
  async release(mediaId: string): Promise<void> {
    await this.command('release', { media_id: mediaId });
  }
  async upload(operationId: string, data: Uint8Array, mimeType: string, sha256: string,
    metadata: Record<string, unknown> = {}, saveTo: string | null = null): Promise<BrowserOperationStatus> {
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
    const controller = new AbortController();
    this.controllers.set(operationId, controller);
    try {
      const response = await fetch(endpoint(`nbinlineai/browser-media-bytes/${encodeURIComponent(operationId)}`), {
        method: 'POST', credentials: 'same-origin', headers: requestHeaders, body: data as BodyInit,
        signal: controller.signal
      });
      const status = await response.json();
      if (!response.ok) throw new Error(status?.error?.message || 'Media upload failed.');
      this.emit(status);
      return status;
    } finally {
      this.controllers.delete(operationId);
    }
  }
  async fetchMedia(mediaId: string): Promise<ArrayBuffer> {
    await this.ready();
    const requestHeaders = headers(this.ownerSecret);
    const identity = this.identity();
    requestHeaders.set('X-NBInlineAI-Session', identity.session_id);
    requestHeaders.set('X-NBInlineAI-Client', identity.client_id);
    requestHeaders.set('X-NBInlineAI-Model', identity.model_id);
    const response = await fetch(endpoint(`nbinlineai/browser-media-bytes/${encodeURIComponent(mediaId)}`), {
      credentials: 'same-origin', headers: requestHeaders
    });
    if (!response.ok) throw new Error('Media result expired or is unavailable.');
    return response.arrayBuffer();
  }
  onStatus(listener: (operation: BrowserOperationStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  emit(status: BrowserOperationStatus): void { this.listeners.forEach(listener => listener(status)); }
  addCleanup(cleanup: () => void): void { this.onDispose.add(cleanup); }
  async start(request: BrowserOperationRequest): Promise<BrowserOperationStatus> {
    const entry = handlers.get(request.name);
    if (!entry) throw new Error(`Unsupported browser operation: ${request.name}`);
    if (!entry.capability().available) throw new Error(entry.capability().reason || 'Browser operation is unavailable.');
    const status = await this.create(request);
    this.emit(status);
    void entry.handler(this, request, status).catch(async error => {
      try { this.emit(await this.transition(status.operation_id, 'failed', undefined, {
        code: 'unsupported', message: error instanceof Error ? error.message.slice(0, 400) : 'Browser operation failed'
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
    this.onDispose.forEach(cleanup => cleanup());
    await closing;
    // The lease is the fallback if pagehide prevents a final authenticated request.
  }
}
