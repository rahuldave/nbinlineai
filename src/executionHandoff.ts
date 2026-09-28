import { ICellModel } from '@jupyterlab/cells';
import { NotebookPanel } from '@jupyterlab/notebook';
import { Kernel } from '@jupyterlab/services';
import { scheduleNotebookContinuation } from './executionQueue';
import { runTrackedStandardCell } from './insertTools';
import { ExecutionTextCollector } from './executionOutput';

export type HandoffOperation = 'add_code_cell_and_execute' | 'prompt_and_run' | 'run_and_prompt';
export interface HandoffArguments { content?: string; cell_id?: string; after_cell_id?: string; prompt?: string }
export interface HandoffReceipt { ok: boolean; chain_id?: string; step_id?: string; cell_id?: string; status?: string; error?: string }
export interface ExecutionResult {
  chain_id: string; step_id: string; cell_id: string; msg_id: string; status: string;
  source_sha256: string; text: string; truncated: boolean; rich_output_omitted: boolean;
}
interface BoundStep {
  cellId: string; source: string; chainId: string; stepId: string;
  sessionId: string; kernel: Kernel.IKernelConnection;
}
const MAX_STEPS = 8;
const chains = new Map<string, number>();
export function finishHandoffChain(chainId: string): void { chains.delete(chainId); }

function cell(panel: NotebookPanel, id: string): ICellModel | null {
  const cells = panel.content.model?.cells;
  if (!cells) return null;
  for (let i = 0; i < cells.length; i++) if (cells.get(i).id === id) return cells.get(i);
  return null;
}
function valid(panel: NotebookPanel, model: object, sessionId: string, kernel: Kernel.IKernelConnection): boolean {
  return !panel.isDisposed && panel.content.model === model && panel.sessionContext.session?.id === sessionId &&
    panel.sessionContext.session?.kernel === kernel;
}
function requireText(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid ${name}.`);
  return value;
}
function optionalText(value: unknown, name: string, max: number): string {
  if (value === undefined || value === '') return '';
  return requireText(value, name, max);
}
/** Capture IOPub only from this execute_request, not from the cell's last outputs. */
async function executeCode(panel: NotebookPanel, step: BoundStep): Promise<ExecutionResult> {
  const model = panel.content.model;
  if (!model || !valid(panel, model, step.sessionId, step.kernel)) throw new Error('Notebook or kernel changed before execution.');
  const target = cell(panel, step.cellId);
  if (!target || target.type !== 'code' || target.sharedModel.getSource() !== step.source) {
    throw new Error('Code cell was removed or changed before execution.');
  }
  const widget = panel.content.widgets.find(candidate => candidate.model === target);
  if (!widget) throw new Error('Code cell widget is unavailable.');
  let msgId = '';
  let executedSource: string | null = null;
  const output = new ExecutionTextCollector();
  const onMessage = (_: Kernel.IKernelConnection, args: Kernel.IAnyMessageArgs): void => {
    const message = args.msg;
    if (args.direction === 'send' && message.header.msg_type === 'execute_request' &&
        message.metadata.cellId === step.cellId) {
      msgId = message.header.msg_id;
      const code = (message.content as Record<string, unknown>).code;
      executedSource = typeof code === 'string' ? code : null;
      return;
    }
    if (!msgId || args.direction !== 'recv' || message.parent_header?.msg_id !== msgId) return;
    output.accept(message.header.msg_type, message.content as Record<string, unknown>);
  };
  step.kernel.anyMessage.connect(onMessage);
  try {
    const success = await runTrackedStandardCell({
      cell: widget, notebook: model, notebookConfig: panel.content.notebookConfig,
      sessionContext: panel.sessionContext, onCellExecutionScheduled: () => undefined,
      onCellExecuted: () => undefined
    }, panel, step.chainId);
    const sourceDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(executedSource ?? ''));
    const sourceSha256 = Array.from(new Uint8Array(sourceDigest), byte => byte.toString(16).padStart(2, '0')).join('');
    const captured = output.snapshot();
    return { chain_id: step.chainId, step_id: step.stepId, cell_id: step.cellId,
      msg_id: msgId, source_sha256: sourceSha256,
      status: executedSource !== null && executedSource !== step.source ? 'source_changed' :
        success && msgId && executedSource === step.source ? 'completed' : 'failed',
      ...captured };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    output.accept('stream', { text: `\n${detail}` });
    const result = output.snapshot();
    return { chain_id: step.chainId, step_id: step.stepId, cell_id: step.cellId,
      msg_id: msgId, source_sha256: '', status: 'failed', ...result };
  } finally {
    step.kernel.anyMessage.disconnect(onMessage);
  }
}

export interface HandoffOwner {
  panel: NotebookPanel;
  originCellId: string;
  defaultAfterCellId?: string;
  chainId?: string;
  onPrompt: (promptId: string, predecessor?: ExecutionResult, chainId?: string, requireCodeChoice?: boolean) => Promise<boolean>;
  onStatus: (state: string, message: string) => void;
}

/** Schedule once while the caller owns the queue; the caller never awaits a successor. */
export function requestExecutionHandoff(owner: HandoffOwner, operation: HandoffOperation, args: HandoffArguments): HandoffReceipt {
  let insertedCellId = '';
  let scheduled = false;
  let createdChainId = '';
  let priorChainCount: number | undefined;
  try {
    const panel = owner.panel;
    const model = panel.content.model;
    const session = panel.sessionContext.session;
    const kernel = session?.kernel;
    if (!model || !session || !kernel || panel.isDisposed || !cell(panel, owner.originCellId)) throw new Error('Originating notebook, cell or kernel is unavailable.');
    const existing = optionalText(args.cell_id, 'cell ID', 200);
    const content = optionalText(args.content, 'code', 8000);
    const anchor = optionalText(args.after_cell_id, 'anchor cell ID', 200);
    const prompt = operation === 'add_code_cell_and_execute' ? '' : requireText(args.prompt, 'prompt', 16000);
    if (operation !== 'prompt_and_run' && Boolean(content) === Boolean(existing)) throw new Error('Choose exactly one of code content or an existing cell ID.');
    if (operation === 'prompt_and_run' && (content || existing)) throw new Error('prompt_and_run only accepts a new question.');
    if (existing && anchor) throw new Error('Placement is only available for new code.');
    const count = owner.chainId ? chains.get(owner.chainId) || 0 : 0;
    if (count >= MAX_STEPS) throw new Error('This handoff chain reached its eight-step limit.');
    const chainId = owner.chainId || crypto.randomUUID();
    createdChainId = chainId;
    priorChainCount = chains.get(chainId);
    const stepId = crypto.randomUUID();
    const placeAfter = anchor || owner.defaultAfterCellId || owner.originCellId;
    const anchorCell = cell(panel, placeAfter);
    if (!anchorCell) throw new Error('Insertion anchor was removed.');
    let targetId = existing;
    if (operation !== 'prompt_and_run' && content) {
      const index = Array.from({ length: model.cells.length }, (_, i) => model.cells.get(i).id).indexOf(placeAfter);
      model.sharedModel.insertCell(index + 1, { cell_type: 'code', source: content, metadata: {} });
      targetId = model.cells.get(index + 1).id;
      insertedCellId = targetId;
    }
    if (operation === 'prompt_and_run') {
      const index = Array.from({ length: model.cells.length }, (_, i) => model.cells.get(i).id).indexOf(placeAfter);
      model.sharedModel.insertCell(index + 1, {
        cell_type: 'markdown', source: `${prompt}\n\n&\`add_code_cell_and_execute\``,
        metadata: { nbinlineai: { isPromptCell: true } }
      });
      targetId = model.cells.get(index + 1).id;
      insertedCellId = targetId;
    }
    const target = cell(panel, targetId);
    if (!target || (operation !== 'prompt_and_run' && target.type !== 'code')) throw new Error('Target code cell is unavailable.');
    const source = target.sharedModel.getSource();
    const bound: BoundStep = { cellId: targetId, source, chainId, stepId, sessionId: session.id, kernel };
    chains.set(chainId, count + 1);
    const next = async (): Promise<boolean> => {
      if (!valid(panel, model, session.id, kernel) || cell(panel, targetId)?.sharedModel.getSource() !== source) {
        owner.onStatus('failed', 'Handoff stopped: notebook, kernel or target changed.');
        finishHandoffChain(chainId);
        return false;
      }
      owner.onStatus('running', operation === 'prompt_and_run' ? 'Running follow-up question…' : 'Running code cell…');
      if (operation === 'prompt_and_run') {
        const chosen = await owner.onPrompt(targetId, undefined, chainId, true);
        if (!chosen) owner.onStatus('skipped', 'Follow-up question ended without a new code execution.');
        return chosen;
      }
      const result = await executeCode(panel, bound);
      if (result.status !== 'completed') {
        owner.onStatus('failed', result.status === 'source_changed'
          ? 'Code ran after its source changed; the next step was stopped.'
          : 'Handoff stopped after code execution failed or could not be attributed.');
        finishHandoffChain(chainId);
        return false;
      }
      if (operation === 'run_and_prompt') {
        const index = Array.from({ length: model.cells.length }, (_, i) => model.cells.get(i).id).indexOf(targetId);
        model.sharedModel.insertCell(index + 1, { cell_type: 'markdown', source: prompt,
          metadata: { nbinlineai: { isPromptCell: true } } });
        const promptId = model.cells.get(index + 1).id;
        return owner.onPrompt(promptId, result, chainId);
      }
      owner.onStatus('completed', `Code cell ${targetId} completed.`);
      finishHandoffChain(chainId);
      return true;
    };
    scheduleNotebookContinuation(model, next, operation === 'prompt_and_run' ? undefined : { cellId: targetId, source },
      () => { finishHandoffChain(chainId); owner.onStatus('cancelled', 'Handoff stopped because its caller did not complete.'); });
    scheduled = true;
    owner.onStatus('scheduled', operation === 'prompt_and_run' ? 'Follow-up question scheduled.' : `Code cell ${targetId} scheduled.`);
    return { ok: true, chain_id: chainId, step_id: stepId, cell_id: targetId, status: 'scheduled' };
  } catch (error) {
    if (!scheduled && insertedCellId) {
      try {
        const cells = owner.panel.content.model?.cells;
        if (cells) for (let i = 0; i < cells.length; i++) {
          if (cells.get(i).id === insertedCellId) { owner.panel.content.model?.sharedModel.deleteCell(i); break; }
        }
      } catch { /* The schedule still failed; report the original reason. */ }
    }
    if (!scheduled && createdChainId) {
      if (priorChainCount === undefined) finishHandoffChain(createdChainId);
      else chains.set(createdChainId, priorChainCount);
    }
    return { ok: false, error: error instanceof Error ? error.message : String(error), status: 'failed' };
  }
}
