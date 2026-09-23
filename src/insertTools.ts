/** Execution-bound notebook insertion for the Python insert_tools helper. */
import { INotebookCellExecutor, NotebookPanel, runCell as runStandardCell } from '@jupyterlab/notebook';
import { Kernel, KernelMessage } from '@jupyterlab/services';
import { INSERT_TOOLS_TARGET, parseInsertRequest, insertionIndex } from './insertToolsProtocol';

interface Origin {
  panel: NotebookPanel;
  notebook: INotebookCellExecutor.IRunCellOptions['notebook'];
  cellId: string;
  kernel: Kernel.IKernelConnection;
  lastInsertedId?: string;
  seenCommIds: Set<string>;
}

class KernelInsertToolsBridge {
  private readonly origins = new Map<string, Origin>();

  constructor(private readonly kernel: Kernel.IKernelConnection) {
    kernel.registerCommTarget(INSERT_TOOLS_TARGET, (comm, message) => {
      this.onOpen(comm, message);
    });
  }

  trackScheduled(options: INotebookCellExecutor.IRunCellOptions, panel: NotebookPanel): () => void {
    let requestId = '';
    const onAnyMessage = (_: Kernel.IKernelConnection, args: Kernel.IAnyMessageArgs): void => {
      const message = args.msg;
      if (args.direction !== 'send' || message.header.msg_type !== 'execute_request' ||
          message.metadata.cellId !== options.cell.model.id) return;
      requestId = message.header.msg_id;
      this.origins.set(requestId, {
        panel, notebook: options.notebook, cellId: options.cell.model.id, kernel: this.kernel,
        seenCommIds: new Set<string>()
      });
      this.kernel.anyMessage.disconnect(onAnyMessage);
    };
    this.kernel.anyMessage.connect(onAnyMessage);
    return () => {
      this.kernel.anyMessage.disconnect(onAnyMessage);
      if (requestId) globalThis.setTimeout(() => this.origins.delete(requestId), 30_000);
    };
  }

  private onOpen(comm: Kernel.IComm, message: KernelMessage.ICommOpenMsg): void {
    const request = parseInsertRequest(message.content.data);
    const parentId = message.parent_header?.msg_id;
    const origin = typeof parentId === 'string' ? this.origins.get(parentId) : undefined;
    // Other Jupyter clients can receive the same IOPub comm. Only the client
    // that sent this exact execute_request may act or acknowledge it.
    if (!origin || origin.seenCommIds.has(comm.commId)) return;
    origin.seenCommIds.add(comm.commId);
    const fail = (text: string): void => {
      void comm.send({ ok: false, error: text }).done.catch(() => undefined);
    };
    if (!request || request.execute_request_id !== parentId ||
        request.source_cell_id !== origin.cellId) {
      fail('Invalid insert_tools request for the executing code cell.');
      return;
    }
    if (origin.panel.isDisposed || origin.panel.content.model !== origin.notebook ||
        origin.panel.sessionContext.session?.kernel !== origin.kernel) {
      fail('The originating notebook or kernel changed before insertion.');
      return;
    }
    const model = origin.notebook;
    const ids = Array.from({ length: model.cells.length }, (_, index) => model.cells.get(index).id);
    try {
      const index = insertionIndex(ids, origin.cellId, origin.lastInsertedId);
      model.sharedModel.insertCell(index, {
        cell_type: 'markdown', source: request.content, metadata: {}
      });
      const insertedId = model.cells.get(index).id;
      origin.lastInsertedId = insertedId;
      void comm.send({ ok: true, cell_id: insertedId }).done.catch(() => undefined);
    } catch (error) {
      fail(error instanceof Error ? error.message : 'Could not insert the Markdown cell.');
    }
  }
}

const bridges = new WeakMap<Kernel.IKernelConnection, KernelInsertToolsBridge>();

/** Delegate normal execution after binding its outgoing request to a notebook. */
export function runTrackedStandardCell(
  options: INotebookCellExecutor.IRunCellOptions,
  panel: NotebookPanel | undefined
): Promise<boolean> {
  if (options.cell.model.type !== 'code' || !panel || panel.isDisposed) {
    return runStandardCell(options);
  }
  let cleanup: (() => void) | undefined;
  return runStandardCell({
    ...options,
    onCellExecutionScheduled: args => {
      options.onCellExecutionScheduled(args);
      // Native execution may have started a kernel just before this callback.
      const kernel = options.sessionContext?.session?.kernel;
      if (!kernel) return;
      let bridge = bridges.get(kernel);
      if (!bridge) {
        bridge = new KernelInsertToolsBridge(kernel);
        bridges.set(kernel, bridge);
      }
      cleanup = bridge.trackScheduled(options, panel);
    }
  }).finally(() => cleanup?.());
}
