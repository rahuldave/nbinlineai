/** Execution-bound comm dispatch for nonblocking Python browser receipts. */
import { INotebookCellExecutor, NotebookPanel } from '@jupyterlab/notebook';
import { Kernel, KernelMessage } from '@jupyterlab/services';
import { BrowserOperationContext, BrowserOperationRequest, BrowserOperationStatus, browserCapabilityFacts } from './browserMediaClient';

const TARGET = 'nbinlineai.browser_media.v1';
interface Origin { panel: NotebookPanel; cellId: string; kernel: Kernel.IKernelConnection; }
const contexts = new WeakMap<NotebookPanel, BrowserOperationContext>();
export function mediaContext(panel: NotebookPanel, kernel: Kernel.IKernelConnection): BrowserOperationContext {
  let context = contexts.get(panel);
  if (!context || context.kernel !== kernel) { context = new BrowserOperationContext(panel, kernel); contexts.set(panel, context); }
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
      this.origins.set(id, { panel, cellId: options.cell.model.id, kernel: this.kernel });
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
    if (!origin || !validRequest(request) || request.execute_request_id !== parentId ||
        request.source_cell_id !== origin.cellId || origin.panel.isDisposed ||
        origin.panel.sessionContext.session?.kernel !== origin.kernel) return;
    const context = mediaContext(origin.panel, origin.kernel);
    let sentStatus = '';
    const send = async (state: BrowserOperationStatus, final = false): Promise<void> => {
      const marker = JSON.stringify(state);
      if (marker === sentStatus) return;
      sentStatus = marker;
      let buffers: ArrayBuffer[] = [];
      if (final && state.status === 'completed' && typeof state.media?.media_id === 'string') {
        try { buffers = [await context.fetchMedia(state.media.media_id)]; }
        catch (error) { state = { ...state, status: 'failed', error: { code: 'stale_target', message: String(error).slice(0, 300) } }; }
      }
      await comm.send(state as unknown as { [key: string]: any }, {}, buffers).done;
      if (final) comm.close();
    };
    try {
      if (request.name === 'browser_capabilities') {
        const state: BrowserOperationStatus = { operation_id: request.request_id, status: 'completed',
          result: { secure_context: window.isSecureContext, operations: browserCapabilityFacts(),
            limits: { image_max_side: 4096, image_max_pixels: 16000000,
              notebook_media_bytes: 104857600, media_idle_seconds: 600,
              owner_lease_seconds: 90, permission_seconds: 120,
              recording_saved_seconds: 300, recording_saved_bytes: 52428800,
              recording_memory_seconds: 60, recording_memory_bytes: 16777216 } } };
        await send(state, true); return;
      }
      if (request.name === 'operation_status') {
        const state = await context.status(String(request.arguments.operation_id));
        await send(state, true); return;
      }
      if (request.name === 'cancel_operation') {
        await send(await context.cancel(String(request.arguments.operation_id)), true); return;
      }
      if (request.name === 'save_media') {
        const media = await context.save(String(request.arguments.media_id), String(request.arguments.save_to ?? 'auto'));
        await send({ operation_id: request.request_id, status: 'completed', media }, true); return;
      }
      if (request.name === 'release_media') {
        await context.release(String(request.arguments.media_id));
        await send({ operation_id: request.request_id, status: 'completed', result: { released: true } }, true); return;
      }
      const state = await context.start(request);
      await send(state);
      if (state.status === 'completed' || state.status === 'failed') { await send(state, true); return; }
      const timer = window.setInterval(() => {
        void context.status(state.operation_id).then(current => {
          const final = ['completed', 'failed', 'cancelled', 'expired'].includes(current.status);
          void send(current, final);
          if (final) window.clearInterval(timer);
        }).catch(() => window.clearInterval(timer));
      }, 1000);
      context.addCleanup(() => { window.clearInterval(timer); comm.close(); });
    } catch (error) {
      await send({ operation_id: request.request_id, status: 'failed', error: {
        code: 'unsupported', message: error instanceof Error ? error.message.slice(0, 300) : 'Browser operation failed'
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
