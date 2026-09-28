/** Serialize notebook cells while keeping each native run's failure boundary. */

interface Obligation { cellId: string; source: string }
interface Entry {
  batch: Batch;
  obligation?: Obligation;
  coalesced: boolean;
  continuations: Array<{ run: () => Promise<boolean>; onDiscard?: () => void }>;
  stage: number;
  scheduledStages: Set<number>;
}
interface Batch { closed: boolean; failed: boolean; entries: Set<Entry> }

interface QueueState {
  tail: Promise<void>;
  currentBatch: Batch | null;
  active: Entry | null;
  pending: number;
}

const queues = new WeakMap<object, QueueState>();

/** Attach a successor to the active job so it runs before later batch cells. */
export function scheduleNotebookContinuation(notebookModel: object, task: () => Promise<boolean>, obligation?: Obligation,
  onDiscard?: () => void): void {
  const state = queues.get(notebookModel);
  const active = state?.active;
  if (!state || !active) throw new Error('No active notebook run owns this handoff.');
  if (active.continuations.length >= 8) throw new Error('Too many handoffs in one notebook step.');
  if (active.scheduledStages.has(active.stage)) throw new Error('This execution already scheduled a handoff.');
  if (obligation) {
    for (const entry of active.batch.entries) {
      if (entry === active || entry.coalesced || entry.obligation?.cellId !== obligation.cellId) continue;
      if (entry.obligation.source !== obligation.source) throw new Error('A later notebook run targets the same cell with different source.');
      entry.coalesced = true;
      break;
    }
  }
  active.scheduledStages.add(active.stage);
  active.continuations.push({ run: task, onDiscard });
}

/**
 * Native NotebookActions.runCells calls every executor synchronously, then
 * awaits them with Promise.all. Calls in that synchronous pass share a batch;
 * the next command starts a new one. Each notebook still runs its cells in
 * order, and one failed cell skips the rest of its batch.
 */
export function enqueueNotebookCell(notebookModel: object, task: () => Promise<boolean>, obligation?: Obligation,
  onCoalesced?: () => void): Promise<boolean> {
  let state = queues.get(notebookModel);
  if (!state) {
    state = { tail: Promise.resolve(), currentBatch: null, active: null, pending: 0 };
    queues.set(notebookModel, state);
  }

  let batch = state.currentBatch;
  if (!batch || batch.closed) {
    batch = { closed: false, failed: false, entries: new Set<Entry>() };
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
  const entry: Entry = { batch, obligation, coalesced: false, continuations: [], stage: 0, scheduledStages: new Set() };
  batch.entries.add(entry);
  selectedState.pending++;
  const result = selectedState.tail.then(async () => {
    if (selectedBatch.failed) return false;
    if (entry.coalesced) { onCoalesced?.(); return true; }
    selectedState.active = entry;
    let dispatched = 0;
    try {
      const success = await task();
      if (!success) { selectedBatch.failed = true; return false; }
      for (let i = 0; i < entry.continuations.length; i++) {
        entry.stage = i + 1;
        dispatched = i + 1;
        if (!await entry.continuations[i].run()) { selectedBatch.failed = true; return false; }
      }
      return true;
    } catch (error) {
      selectedBatch.failed = true;
      throw error;
    } finally {
      for (let i = dispatched; i < entry.continuations.length; i++) entry.continuations[i].onDiscard?.();
      selectedState.active = null;
      selectedBatch.entries.delete(entry);
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
