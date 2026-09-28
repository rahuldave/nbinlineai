/** Visible confirmation of one exact still-image input for one AI question. */
import { ICellModel } from '@jupyterlab/cells';
import { NotebookPanel } from '@jupyterlab/notebook';
import { Widget } from '@lumino/widgets';
import { BrowserMediaError, BrowserOperationContext, BrowserOperationRequest,
  BrowserOperationStatus, registerBrowserOperation } from './browserMediaClient';
import { sha256Bytes } from './browserMediaHash';

type Reference = { media_id: string } | { path: string; sha256: string };
type Detail = 'auto' | 'low' | 'high';
type Confirmation = { version: 1; kind: 'memory' | 'saved'; question_cell_id: string;
  sha256: string; detail: Detail; grant_id?: string; path?: string };

let runningQuestion: (panel: NotebookPanel, questionCellId: string) => boolean = () => false;
let registered = false;

function fail(code: string, message: string): never { throw new BrowserMediaError(code, message); }
function exactReference(value: unknown): Reference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid_argument', 'MediaRef is invalid.');
  const ref = value as Record<string, unknown>;
  if (Object.keys(ref).length === 1 && typeof ref.media_id === 'string' && ref.media_id.length > 0)
    return { media_id: ref.media_id };
  if (Object.keys(ref).length === 2 && typeof ref.path === 'string' && typeof ref.sha256 === 'string' &&
      /^[0-9a-f]{64}$/.test(ref.sha256)) return { path: ref.path, sha256: ref.sha256 };
  return fail('invalid_argument', 'MediaRef needs a media_id or exact path and hash.');
}
function question(context: BrowserOperationContext, id: string, source?: string): ICellModel {
  if (!context.isCurrent() || !id || id.length > 200 || runningQuestion(context.panel, id))
    fail('stale_target', 'The original AI question is unavailable or running.');
  const cells = context.panel.content.model?.cells;
  if (!cells) fail('stale_target', 'The original notebook is unavailable.');
  for (let index = 0; index < cells.length; index++) {
    const cell = cells.get(index);
    if (cell.id !== id) continue;
    const metadata = cell.getMetadata('nbinlineai') as Record<string, unknown> | undefined;
    if (cell.type !== 'markdown' || metadata?.isPromptCell !== true ||
        (source !== undefined && cell.sharedModel.getSource() !== source))
      fail('stale_target', 'The original AI question changed.');
    return cell;
  }
  return fail('stale_target', 'The original AI question was removed.');
}
function confirmation(value: Record<string, unknown>, id: string, hash: string, detail: Detail): Confirmation {
  if (value.version !== 1 || value.question_cell_id !== id || value.sha256 !== hash || value.detail !== detail)
    fail('stale_target', 'Image confirmation changed.');
  if (value.kind === 'memory' && typeof value.grant_id === 'string' && value.grant_id.length > 0)
    return { version: 1, kind: 'memory', question_cell_id: id, grant_id: value.grant_id,
      sha256: hash, detail };
  if (value.kind === 'saved' && typeof value.path === 'string' && value.path.length > 0)
    return { version: 1, kind: 'saved', question_cell_id: id, path: value.path,
      sha256: hash, detail };
  return fail('stale_target', 'Image confirmation is invalid.');
}

async function attach(context: BrowserOperationContext, request: BrowserOperationRequest,
  operation: BrowserOperationStatus): Promise<void> {
  const args = request.arguments;
  const id = args.question_cell_id;
  const detail = args.detail ?? 'auto';
  if (typeof id !== 'string' || !['auto', 'low', 'high'].includes(String(detail)))
    fail('invalid_argument', 'Choose an identified AI question and supported image detail.');
  const chosenDetail = detail as Detail;
  const reference = exactReference(args.media);
  const cell = question(context, id);
  const selected = cell.getMetadata('nbinlineai') as Record<string, unknown> | undefined;
  if (chosenDetail !== 'auto' && !['openai_api', 'openai_codex_subscription'].includes(String(selected?.backend)))
    fail('provider_unsupported', 'This image detail needs an explicit OpenAI API or ChatGPT question choice.');
  const source = cell.sharedModel.getSource();
  const fetched = await context.fetchReference(reference);
  const mime = fetched.mimeType.split(';', 1)[0].toLowerCase();
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mime))
    fail('provider_unsupported', 'Only PNG, JPEG, WebP, or GIF still images can be attached.');
  const bytes = new Uint8Array(fetched.data);
  const hash = await sha256Bytes(bytes);
  if (hash !== fetched.sha256 || ('sha256' in reference && hash !== reference.sha256))
    fail('stale_target', 'Image changed before confirmation.');
  question(context, id, source);

  const widget = new Widget();
  widget.addClass('nbinlineai-attachment-confirmation');
  const label = document.createElement('span');
  const previousAttachment = (cell.getMetadata('nbinlineai') as Record<string, unknown> | undefined)?.mediaAttachment;
  label.textContent = `${previousAttachment ? 'Replace the current attachment with' : 'Attach'} this ${mime.slice(6).toUpperCase()} image (${bytes.byteLength} bytes) ${previousAttachment ? 'for' : 'to'} AI question ${id}?`;
  const preview = document.createElement('img');
  preview.alt = 'Image proposed for this AI question';
  const objectUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
  preview.src = objectUrl;
  const accept = document.createElement('button');
  accept.type = 'button'; accept.textContent = 'Attach image';
  const cancel = document.createElement('button');
  cancel.type = 'button'; cancel.textContent = 'Cancel';
  widget.node.append(label, preview, accept, cancel);
  context.panel.contentHeader.addWidget(widget);
  let ended = false;
  const cleanup = (): void => { if (ended) return; ended = true; URL.revokeObjectURL(objectUrl); widget.dispose(); };
  context.addOperationCleanup(operation.operation_id, cleanup);
  context.addCleanup(cleanup);
  cancel.onclick = () => { void context.cancel(operation.operation_id).finally(cleanup); };
  accept.onclick = () => {
    if (ended) return;
    accept.disabled = true;
    cancel.disabled = true;
    void (async () => {
      question(context, id, source);
      const state = await context.status(operation.operation_id);
      if (state.status !== 'waiting_for_user') fail('stale_target', 'Image confirmation expired.');
      const granted = await context.grantAttachment(operation.operation_id, reference, id, chosenDetail);
      const current = question(context, id, source);
      const confirmed = confirmation(granted, id, hash, chosenDetail);
      const stillWaiting = await context.status(operation.operation_id);
      if (stillWaiting.status !== 'waiting_for_user') fail('stale_target', 'Image confirmation expired.');
      const before = (current.getMetadata('nbinlineai') as Record<string, unknown> | undefined) || {};
      current.setMetadata('nbinlineai', { ...before, mediaAttachment: confirmed });
      try {
        const complete = await context.transition(operation.operation_id, 'completed', {
          confirmed: true, question_cell_id: id, sha256: hash, detail: chosenDetail });
        if (complete.status !== 'completed') fail('stale_target', 'Image confirmation was cancelled.');
      } catch (error) {
        if (context.isCurrent()) {
          const observed = current.getMetadata('nbinlineai') as Record<string, unknown> | undefined;
          if (observed?.mediaAttachment && JSON.stringify(observed.mediaAttachment) === JSON.stringify(confirmed)) {
            const restored = { ...observed };
            if (Object.prototype.hasOwnProperty.call(before, 'mediaAttachment'))
              restored.mediaAttachment = before.mediaAttachment;
            else delete restored.mediaAttachment;
            current.setMetadata('nbinlineai', restored);
          }
        }
        throw error;
      }
    })().catch(async error => {
      try { await context.transition(operation.operation_id, 'failed', undefined, {
        code: error instanceof BrowserMediaError ? error.code : 'stale_target',
        message: error instanceof Error ? error.message.slice(0, 300) : 'Image confirmation failed.'
      }); } catch { /* cancellation or owner loss already ended the operation */ }
    }).finally(cleanup);
  };
}

/** Call once from plugin startup; side-effect imports can be dropped from bundles. */
export function registerBrowserMediaAttachment(isRunning: (panel: NotebookPanel, id: string) => boolean): void {
  runningQuestion = isRunning;
  if (registered) return;
  registered = true;
  registerBrowserOperation('attach_media', attach, () => ({ available: true,
    formats: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] }), { waitingForUser: true });
}
