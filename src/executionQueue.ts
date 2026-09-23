/** Serialize notebook cells while keeping each native run's failure boundary. */

interface Batch {
  closed: boolean;
  failed: boolean;
}

interface QueueState {
  tail: Promise<void>;
  currentBatch: Batch | null;
  pending: number;
}

const queues = new WeakMap<object, QueueState>();

/**
 * Native NotebookActions.runCells calls every executor synchronously, then
 * awaits them with Promise.all. Calls in that synchronous pass share a batch;
 * the next command starts a new one. Each notebook still runs its cells in
 * order, and one failed cell skips the rest of its batch.
 */
export function enqueueNotebookCell(notebookModel: object, task: () => Promise<boolean>): Promise<boolean> {
  let state = queues.get(notebookModel);
  if (!state) {
    state = { tail: Promise.resolve(), currentBatch: null, pending: 0 };
    queues.set(notebookModel, state);
  }

  let batch = state.currentBatch;
  if (!batch || batch.closed) {
    batch = { closed: false, failed: false };
    state.currentBatch = batch;
    const currentState = state;
    const currentBatch = batch;
    queueMicrotask(() => {
      currentBatch.closed = true;
      if (currentState.pending === 0 && currentState.currentBatch === currentBatch) {
        queues.delete(notebookModel);
      }
    });
  }

  const selectedBatch = batch;
  const selectedState = state;
  selectedState.pending++;
  const result = selectedState.tail.then(async () => {
    if (selectedBatch.failed) return false;
    try {
      const success = await task();
      if (!success) selectedBatch.failed = true;
      return success;
    } catch (error) {
      selectedBatch.failed = true;
      throw error;
    }
  });

  // Keep the scheduling chain alive after a rejection without hiding that
  // rejection from the caller's NotebookActions.runCells Promise.all.
  selectedState.tail = result.then(() => undefined, () => undefined);
  const settled = () => {
    selectedState.pending--;
    if (selectedState.pending === 0 && selectedState.currentBatch?.closed) {
      queues.delete(notebookModel);
    }
  };
  void result.then(settled, settled);
  return result;
}
