/** Model for notebook-local browser media status. */
import { BrowserMediaError, BrowserOperationContext, BrowserOperationStatus } from './browserMediaClient';

const pending = new Set<BrowserOperationStatus['status']>(['running', 'waiting_for_user', 'paused', 'saving']);
const terminal = new Set<BrowserOperationStatus['status']>(['completed', 'cancelled', 'failed', 'expired']);

/** Keep visible receipts in step with server expiry even after an AI turn ends. */
export class BrowserMediaStatusModel {
  private readonly records = new Map<string, BrowserOperationStatus>();
  private readonly disconnect: () => void;
  private readonly timer: number;
  private refreshing = false;
  private disposed = false;

  constructor(private readonly context: Pick<BrowserOperationContext, 'onStatus' | 'status' | 'cancel'>,
    private readonly changed: (records: BrowserOperationStatus[]) => void) {
    this.disconnect = context.onStatus(item => this.update(item));
    this.timer = window.setInterval(() => { void this.refresh(); }, 5000);
  }

  private update(item: BrowserOperationStatus): void {
    if (this.disposed) return;
    const previous = this.records.get(item.operation_id);
    // A delayed status response must not restore Stop after cancellation.
    if (previous && terminal.has(previous.status) && !terminal.has(item.status)) return;
    this.records.delete(item.operation_id);
    this.records.set(item.operation_id, item);
    while (this.records.size > 5) this.records.delete(this.records.keys().next().value!);
    this.changed(Array.from(this.records.values()));
  }

  private unavailable(operationId: string, error: unknown): void {
    if (!(error instanceof BrowserMediaError) || error.code !== 'stale_target') return;
    const previous = this.records.get(operationId);
    if (previous && pending.has(previous.status)) this.update({ operation_id: operationId, status: 'expired',
      error: { code: 'stale_target', message: 'Browser operation expired or its owner changed.' } });
  }

  async refresh(): Promise<void> {
    if (this.disposed || this.refreshing) return;
    this.refreshing = true;
    try {
      for (const [id, item] of Array.from(this.records)) {
        if (!pending.has(item.status)) continue;
        try { this.update(await this.context.status(id)); }
        catch (error) { this.unavailable(id, error); }
      }
    } finally { this.refreshing = false; }
  }

  async stop(operationId: string): Promise<void> {
    const item = this.records.get(operationId);
    if (!item || !pending.has(item.status) || this.disposed) return;
    try { this.update(await this.context.cancel(operationId)); }
    catch (error) { this.unavailable(operationId, error); }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.clearInterval(this.timer);
    this.disconnect();
  }
}
