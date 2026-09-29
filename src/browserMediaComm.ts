/** Execution-bound comm dispatch for nonblocking Python browser receipts. */
import { INotebookCellExecutor, NotebookPanel } from '@jupyterlab/notebook';
import { Kernel, KernelMessage } from '@jupyterlab/services';
import { BrowserMediaError, BrowserOperationContext, BrowserOperationRequest, BrowserOperationStatus, browserCapabilityFacts, observedMediaPermissions } from './browserMediaClient';

const TARGET = 'nbinlineai.browser_media.v1';
interface Origin { panel: NotebookPanel; model: INotebookCellExecutor.IRunCellOptions['notebook']; cellId: string; kernel: Kernel.IKernelConnection; }
const contexts = new WeakMap<NotebookPanel, BrowserOperationContext>();
export function mediaContext(panel: NotebookPanel, kernel: Kernel.IKernelConnection): BrowserOperationContext {
  let context = contexts.get(panel);
  if (!context || context.kernel !== kernel || !context.isCurrent()) {
    if (context) void context.dispose();
    context = new BrowserOperationContext(panel, kernel);
    contexts.set(panel, context);
  }
  return context;
}
function validRequest(value: unknown): value is BrowserOperationRequest & { execute_request_id: string; source_cell_id: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return item.version === 1 && typeof item.execute_request_id === 'string' &&
    typeof item.source_cell_id === 'string' && typeof item.request_id === 'string' &&
    typeof item.name === 'string' && !!item.arguments && typeof item.arguments === 'object' && !Array.isArray(item.arguments);
}
class BrowserCommBridge {
  private readonly origins = new Map<string, Origin>();
  constructor(private readonly kernel: Kernel.IKernelConnection) {
    kernel.registerCommTarget(TARGET, (comm, message) => { void this.onOpen(comm, message); });
  }
  track(options: INotebookCellExecutor.IRunCellOptions, panel: NotebookPanel): () => void {
    let id = '';
    const onMessage = (_: Kernel.IKernelConnection, args: Kernel.IAnyMessageArgs): void => {
      if (args.direction !== 'send' || args.msg.header.msg_type !== 'execute_request' ||
          args.msg.metadata.cellId !== options.cell.model.id) return;
      id = args.msg.header.msg_id;
      this.origins.set(id, { panel, model: options.notebook, cellId: options.cell.model.id, kernel: this.kernel });
      this.kernel.anyMessage.disconnect(onMessage);
    };
    this.kernel.anyMessage.connect(onMessage);
    return () => {
      this.kernel.anyMessage.disconnect(onMessage);
      if (id) window.setTimeout(() => this.origins.delete(id), 120_000);
    };
  }
  private async onOpen(comm: Kernel.IComm, message: KernelMessage.ICommOpenMsg): Promise<void> {
    const request = message.content.data;
    const parentId = message.parent_header?.msg_id;
    const origin = typeof parentId === 'string' ? this.origins.get(parentId) : undefined;
    const hasOriginCell = (): boolean => {
      if (!origin) return false;
      const cells = origin.model.cells;
      for (let i = 0; i < cells.length; i++) if (cells.get(i).id === origin.cellId) return true;
      return false;
    };
    if (!origin || !validRequest(request) || request.execute_request_id !== parentId ||
        request.source_cell_id !== origin.cellId || origin.panel.isDisposed ||
        origin.panel.content.model !== origin.model ||
        origin.panel.sessionContext.session?.kernel !== origin.kernel || !hasOriginCell()) {
      comm.close();
      return;
    }
    const context = mediaContext(origin.panel, origin.kernel);
    let sentStatus = '';
    const send = async (state: BrowserOperationStatus, final = false, withBytes = true): Promise<void> => {
      if (!context.isCurrent() || origin.panel.content.model !== origin.model || !hasOriginCell()) { comm.close(); return; }
      const marker = JSON.stringify([state, final]);
      if (marker === sentStatus) return;
      sentStatus = marker;
      let buffers: ArrayBuffer[] = [];
      if (final && withBytes && state.status === 'completed' && state.media) {
        try {
          let descriptors = Array.isArray(state.media) ? [...state.media] : [state.media];
          let cursor = state.next_media_cursor;
          while (typeof cursor === 'number') {
            const page = await context.mediaPage(state.operation_id, cursor);
            descriptors = descriptors.concat(page.media);
            cursor = page.next_media_cursor ?? undefined;
          }
          if (descriptors.length > 12) throw new Error('Media batch exceeds 12 items');
          buffers = await Promise.all(descriptors.map(item => context.fetchMedia(String(item.media_id))));
          if (Array.isArray(state.media)) state = { ...state, media: descriptors, next_media_cursor: undefined };
        }
        catch (error) { state = { ...state, status: 'failed', error: { code: 'stale_target', message: String(error).slice(0, 300) } }; }
      }
      if (!context.isCurrent() || origin.panel.content.model !== origin.model || !hasOriginCell()) { comm.close(); return; }
      // A comm_msg future can wait for a kernel reply while that kernel is busy.
      // Queue the message and let Python close the channel after delivery.
      void comm.send(state as unknown as { [key: string]: any }, {}, buffers).done.catch(() => undefined);
    };
    try {
      if (request.name === 'browser_capabilities') {
        const created = await context.create(request);
        await context.transition(created.operation_id, 'completed', { checked: true });
        const state: BrowserOperationStatus = { operation_id: created.operation_id, status: 'completed',
          result: { secure_context: window.isSecureContext, permissions: await observedMediaPermissions(),
            file_media_supported: context.fileMediaSupported(), ...browserCapabilityFacts(context.fileMediaSupported()),
            limits: { image_max_side: 4096, image_max_pixels: 16000000,
              batch_max_items: 12, batch_max_decoded_pixels: 32000000,
              notebook_media_bytes: 104857600, server_media_bytes: 268435456,
              upload_max_bytes: 52428800, media_idle_seconds: 600,
              owner_lease_seconds: 90, permission_seconds: 120,
              recording_saved_seconds: 300, recording_saved_bytes: 52428800,
              recording_memory_seconds: 60, recording_memory_bytes: 16777216 } } };
        await send(state, true, false); return;
      }
      if (request.name === 'operation_status') {
        const targetId = String(request.arguments.operation_id);
        const snapshot = await context.status(targetId);
        await send({ operation_id: targetId, status: 'completed',
          result: snapshot as unknown as Record<string, unknown> }, true, false); return;
      }
      if (request.name === 'cancel_operation') {
        await send(await context.cancel(String(request.arguments.operation_id)), true, false); return;
      }
      if (request.name === 'save_media') {
        const reference = request.arguments.media as { media_id: string } | { path: string; sha256: string };
        const saveTo = request.arguments.save_to;
        if (typeof saveTo !== 'string' || !saveTo)
          throw new BrowserMediaError('invalid_argument', 'save_to must name a destination');
        const started = await context.startSave(reference, saveTo, request.request_id);
        if (!['completed', 'failed', 'cancelled', 'expired'].includes(started.initial.status))
          await send(started.initial, false, false);
        await send(await started.completion, true, false);
        return;
      }
      if (request.name === 'release_media') {
        await send(await context.releaseOperation(request), true, false);
        return;
      }
      const state = await context.start(request);
      if (state.status === 'completed' || state.status === 'failed') { await send(state, true); return; }
      await send(state);
      let polling = false;
      const deadline = window.setTimeout(() => {
        window.clearInterval(timer);
        void send({ operation_id: state.operation_id, status: 'expired', error: {
          code: 'timeout', message: 'Browser receipt delivery timed out.'
        } }, true, false);
      }, 8 * 60_000);
      const timer = window.setInterval(() => {
        if (polling) return;
        polling = true;
        void context.status(state.operation_id).then(current => {
          const final = ['completed', 'failed', 'cancelled', 'expired'].includes(current.status);
          void send(current, final);
          if (final) { window.clearInterval(timer); window.clearTimeout(deadline); }
        }).catch(error => {
          window.clearInterval(timer); window.clearTimeout(deadline);
          void send({ operation_id: state.operation_id, status: 'expired', error: {
            code: 'stale_target', message: error instanceof Error ? error.message.slice(0, 300) : 'Browser owner lost'
          } }, true, false);
        }).finally(() => { polling = false; });
      }, 1000);
      context.addCleanup(() => { window.clearInterval(timer); window.clearTimeout(deadline); comm.close(); });
    } catch (error) {
      await send({ operation_id: request.request_id, status: 'failed', error: {
        code: error instanceof BrowserMediaError ? error.code : 'unsupported',
        message: error instanceof Error ? error.message.slice(0, 300) : 'Browser operation failed'
      } }, true);
    }
  }
}
const bridges = new WeakMap<Kernel.IKernelConnection, BrowserCommBridge>();
export function trackBrowserMediaCell(options: INotebookCellExecutor.IRunCellOptions, panel: NotebookPanel,
  kernel: Kernel.IKernelConnection): () => void {
  let bridge = bridges.get(kernel);
  if (!bridge) { bridge = new BrowserCommBridge(kernel); bridges.set(kernel, bridge); }
  return bridge.track(options, panel);
}
