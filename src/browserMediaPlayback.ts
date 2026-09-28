/** Visible, notebook-owned file, preview, and clipboard operations. */
import { Widget } from '@lumino/widgets';
import { BrowserMediaError, BrowserOperationContext, BrowserOperationRequest,
  BrowserOperationStatus, registerBrowserOperation } from './browserMediaClient';
import { ClipMediaLease, DecodedMediaLease, MediaRef, loadPlaybackMedia,
  reserveMediaWorkingPixels, sha256Bytes } from './browserMediaDecoder';

interface Preview { id: string; widget: Widget; lease: DecodedMediaLease; releaseDisplay: () => void; }
class PlaybackState {
  readonly previews = new Map<string, Preview>();
  readonly pending = new Set<Widget>();
  private readonly host = document.createElement('div');
  constructor(context: BrowserOperationContext) {
    this.host.className = 'nbinlineai-playback-host';
    this.host.setAttribute('aria-label', 'Notebook media controls');
    document.body.appendChild(this.host);
    context.addCleanup(() => this.dispose());
  }
  panel(title: string): { widget: Widget; body: HTMLElement } {
    const widget = new Widget();
    widget.addClass('nbinlineai-playback-panel');
    widget.node.setAttribute('role', 'group');
    widget.node.setAttribute('aria-label', title);
    const heading = document.createElement('strong'); heading.textContent = title;
    const body = document.createElement('div'); body.className = 'nbinlineai-playback-body';
    widget.node.append(heading, body);
    Widget.attach(widget, this.host);
    this.pending.add(widget);
    widget.disposed.connect(() => this.pending.delete(widget));
    return { widget, body };
  }
  close(previewId: string): boolean {
    const preview = this.previews.get(previewId);
    if (!preview) return false;
    this.previews.delete(previewId);
    preview.releaseDisplay(); preview.lease.release(); preview.widget.dispose();
    return true;
  }
  dispose(): void {
    for (const id of this.previews.keys()) this.close(id);
    for (const widget of this.pending) widget.dispose();
    this.host.remove();
  }
}
const states = new WeakMap<BrowserOperationContext, PlaybackState>();
function state(context: BrowserOperationContext): PlaybackState {
  let value = states.get(context);
  if (!value) { value = new PlaybackState(context); states.set(context, value); }
  return value;
}
function button(label: string, action: () => void): HTMLButtonElement {
  const item = document.createElement('button');
  item.type = 'button'; item.textContent = label; item.onclick = action;
  return item;
}
function operationError(error: unknown): BrowserMediaError {
  if (error instanceof BrowserMediaError) return error;
  return new BrowserMediaError('unsupported', error instanceof Error ? error.message : 'Browser media action failed.');
}
function randomPreviewId(): string {
  const bytes = new Uint8Array(16); crypto.getRandomValues(bytes);
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}
function mediaRef(value: unknown): MediaRef {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BrowserMediaError('invalid_argument', 'Media must be an exact reference.');
  const input = value as Record<string, unknown>;
  if (typeof input.media_id === 'string' && input.media_id.length > 0 && input.media_id.length <= 100)
    return { media_id: input.media_id };
  if (typeof input.path === 'string' && input.path.length > 0 && input.path.length <= 500 &&
      typeof input.sha256 === 'string' && /^[a-f0-9]{64}$/.test(input.sha256))
    return { path: input.path, sha256: input.sha256 };
  throw new BrowserMediaError('invalid_argument', 'Media needs media_id or exact path and sha256.');
}
function preview(context: BrowserOperationContext, previewId: unknown): Preview {
  if (typeof previewId !== 'string' || !previewId || previewId.length > 100)
    throw new BrowserMediaError('invalid_argument', 'Invalid preview ID.');
  const owned = state(context).previews.get(previewId);
  if (!owned) throw new BrowserMediaError('stale_target', 'Preview is closed or belongs to another notebook.');
  return owned;
}
function clip(context: BrowserOperationContext, previewId: unknown): ClipMediaLease {
  const lease = preview(context, previewId).lease;
  if (lease.kind === 'image') throw new BrowserMediaError('unsupported', 'Still images do not have playback controls.');
  return lease;
}
function limitText(value: unknown): string {
  if (typeof value !== 'string' || value.length > 8000)
    throw new BrowserMediaError('limit_exceeded', 'Text must be at most 8,000 characters.');
  return value;
}
async function finish(context: BrowserOperationContext, operationId: string, result: Record<string, unknown>): Promise<void> {
  await context.transition(operationId, 'running');
  await context.transition(operationId, 'completed', result);
}

async function chooseFile(context: BrowserOperationContext, request: BrowserOperationRequest,
  operation: BrowserOperationStatus): Promise<void> {
  const accept = request.arguments.accept;
  const multiple = request.arguments.multiple;
  const saveTo = request.arguments.save_to;
  if (typeof accept !== 'string' || accept.length > 200 || typeof multiple !== 'boolean' ||
      (saveTo !== null && (typeof saveTo !== 'string' || !saveTo)))
    throw new BrowserMediaError('invalid_argument', 'Invalid file chooser options.');
  const shell = state(context).panel('Choose a file for this notebook');
  const input = document.createElement('input'); input.type = 'file'; input.accept = accept;
  input.multiple = multiple; input.hidden = true;
  const hint = document.createElement('span'); hint.textContent = 'Files stay local unless you request a save.';
  shell.body.append(button('Choose file', () => input.click()), button('Cancel', () => { void context.cancel(operation.operation_id); }), hint, input);
  const files = await new Promise<File[] | null>(resolve => {
    const onCancel = () => { void context.cancel(operation.operation_id).catch(() => undefined); resolve(null); };
    input.addEventListener('cancel', onCancel, { once: true });
    input.addEventListener('change', () => {
      const selected = Array.from(input.files ?? []);
      if (selected.length) resolve(selected); else onCancel();
    }, { once: true });
    context.addOperationCleanup(operation.operation_id, () => {
      shell.widget.dispose(); resolve(null);
    });
  });
  if (files === null) return;
  if (files.length > 12 || (!multiple && files.length !== 1))
    throw new BrowserMediaError('limit_exceeded', 'Select at most 12 files.');
  await context.transition(operation.operation_id, 'running');
  shell.widget.node.querySelector('button')?.setAttribute('disabled', 'true');
  hint.textContent = 'Importing selected files…';
  if (files.length > 1) await context.beginBatch(operation.operation_id, files.length);
  for (const [index, file] of files.entries()) {
    if (!file.size || file.size > 50 * 1024 * 1024)
      throw new BrowserMediaError('limit_exceeded', 'A selected file is empty or exceeds 50 MiB.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!context.isCurrent() || context.operationSignal(operation.operation_id).aborted)
      throw new BrowserMediaError('stale_target', 'The originating notebook or selection changed.');
    const digest = await sha256Bytes(bytes);
    await context.upload(operation.operation_id, bytes, file.type || 'application/octet-stream', digest,
      {}, files.length === 1 ? saveTo : null, files.length > 1 ? index : undefined);
  }
  if (files.length > 1) await context.finishBatch(operation.operation_id, saveTo);
}

async function openMedia(context: BrowserOperationContext, request: BrowserOperationRequest,
  operation: BrowserOperationStatus): Promise<void> {
  const reference = mediaRef(request.arguments.media);
  const lease = await loadPlaybackMedia(context, reference,
    { signal: context.operationSignal(operation.operation_id), preview: true });
  let held = false;
  let previewId: string | undefined;
  let releaseDisplay: () => void = () => undefined;
  let shell: { widget: Widget; body: HTMLElement } | undefined;
  try {
    if (!context.isCurrent() || context.operationSignal(operation.operation_id).aborted)
      throw new BrowserMediaError('stale_target', 'The originating notebook changed.');
    const id = randomPreviewId();
    shell = state(context).panel(`${lease.kind} preview`);
    if (lease.kind === 'image') {
      releaseDisplay = reserveMediaWorkingPixels(context, lease.width, lease.height);
      const canvas = document.createElement('canvas'); canvas.width = lease.width; canvas.height = lease.height;
      const graphics = canvas.getContext('2d');
      if (!graphics) throw new BrowserMediaError('unsupported', 'Canvas preview is unavailable.');
      graphics.drawImage(lease.bitmap, 0, 0);
      shell.body.append(canvas);
    } else {
      shell.body.append(lease.element);
    }
    shell.body.append(button('Close preview', () => { state(context).close(id); }));
    const owned = state(context);
    owned.pending.delete(shell.widget);
    owned.previews.set(id, { id, widget: shell.widget, lease, releaseDisplay }); held = true;
    previewId = id;
    if ('media_id' in reference) context.addMediaCleanup(reference.media_id, () => owned.close(id));
    await context.transition(operation.operation_id, 'completed', {
      preview_id: id, kind: lease.kind, width: lease.width, height: lease.height,
      ...(lease.duration !== null ? { duration_seconds: lease.duration } : {}) });
  } catch (error) {
    if (previewId) state(context).close(previewId);
    throw error;
  } finally {
    if (!held) { shell?.widget.dispose(); releaseDisplay(); lease.release(); }
  }
}

async function playMedia(context: BrowserOperationContext, request: BrowserOperationRequest,
  operation: BrowserOperationStatus): Promise<void> {
  const playing = clip(context, request.arguments.preview_id);
  try {
    await playing.element.play();
    await finish(context, operation.operation_id, { playing: true, seconds: playing.element.currentTime });
    return;
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== 'NotAllowedError') throw operationError(error);
  }
  const shell = state(context).panel('Playback needs a click');
  shell.body.append(button('Play', () => {
    void playing.element.play().then(() => finish(context, operation.operation_id,
      { playing: true, seconds: playing.element.currentTime })).catch(error =>
      context.transition(operation.operation_id, 'failed', undefined, {
        code: 'unsupported', message: error instanceof Error ? error.message.slice(0, 300) : 'Playback failed.'
      }).then(() => undefined));
  }), button('Cancel', () => { void context.cancel(operation.operation_id); }));
  context.addOperationCleanup(operation.operation_id, () => shell.widget.dispose());
}
async function pauseMedia(context: BrowserOperationContext, request: BrowserOperationRequest,
  operation: BrowserOperationStatus): Promise<void> {
  const playing = clip(context, request.arguments.preview_id);
  playing.element.pause();
  await context.transition(operation.operation_id, 'completed', { playing: false, seconds: playing.element.currentTime });
}
async function seekMedia(context: BrowserOperationContext, request: BrowserOperationRequest,
  operation: BrowserOperationStatus): Promise<void> {
  const playing = clip(context, request.arguments.preview_id);
  const seconds = request.arguments.seconds;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0 || seconds > playing.duration)
    throw new BrowserMediaError('invalid_argument', 'Seek time is outside the media duration.');
  const element = playing.element;
  if (!element.seekable.length) throw new BrowserMediaError('unsupported', 'This media cannot be seeked.');
  if (Math.abs(element.currentTime - seconds) > 0.001) {
    await new Promise<void>((resolve, reject) => {
      const signal = context.operationSignal(operation.operation_id);
      const cleanup = () => { window.clearTimeout(timer); element.removeEventListener('seeked', done);
        signal.removeEventListener('abort', cancelled); };
      const done = () => { cleanup(); resolve(); };
      const cancelled = () => { cleanup(); reject(new BrowserMediaError('cancelled', 'Media seek was cancelled.')); };
      const timer = window.setTimeout(() => { cleanup();
        reject(new BrowserMediaError('timeout', 'Media seek timed out.')); }, 10_000);
      element.addEventListener('seeked', done, { once: true }); element.currentTime = seconds;
      signal.addEventListener('abort', cancelled, { once: true });
    });
  }
  if (!context.isCurrent() || context.operationSignal(operation.operation_id).aborted)
    throw new BrowserMediaError('stale_target', 'The preview notebook or seek changed.');
  await context.transition(operation.operation_id, 'completed', { seconds: element.currentTime });
}
async function volumeMedia(context: BrowserOperationContext, request: BrowserOperationRequest,
  operation: BrowserOperationStatus): Promise<void> {
  const playing = clip(context, request.arguments.preview_id);
  const level = request.arguments.level;
  if (typeof level !== 'number' || !Number.isFinite(level) || level < 0 || level > 1)
    throw new BrowserMediaError('invalid_argument', 'Volume must be from 0 through 1.');
  playing.element.volume = level;
  if (Math.abs(playing.element.volume - level) > 0.001)
    throw new BrowserMediaError('unsupported', 'This browser does not allow programmatic volume changes.');
  await context.transition(operation.operation_id, 'completed', { level: playing.element.volume });
}
async function closeMedia(context: BrowserOperationContext, request: BrowserOperationRequest,
  operation: BrowserOperationStatus): Promise<void> {
  const id = request.arguments.preview_id;
  if (typeof id !== 'string' || !state(context).close(id))
    throw new BrowserMediaError('stale_target', 'Preview is already closed or belongs to another notebook.');
  await context.transition(operation.operation_id, 'completed', { closed: true });
}

async function copyText(context: BrowserOperationContext, request: BrowserOperationRequest,
  operation: BrowserOperationStatus): Promise<void> {
  const text = limitText(request.arguments.text);
  const shell = state(context).panel('Copy text');
  const editable = document.createElement('textarea');
  editable.value = text; editable.readOnly = true; editable.setAttribute('aria-label', 'Text to copy');
  const hint = document.createElement('span'); hint.textContent = 'Click Copy, or select the text and use your browser copy shortcut.';
  let started = false;
  const manual = async () => {
    if (started) return;
    started = true;
    await finish(context, operation.operation_id, { copied: true, method: 'manual' });
  };
  editable.addEventListener('copy', () => { void manual(); }, { once: true });
  shell.body.append(editable, hint, button('Copy', () => {
    if (!navigator.clipboard?.writeText) { editable.select(); hint.textContent = 'Press Ctrl/Cmd+C to copy the selected text.'; return; }
    if (started) return;
    void navigator.clipboard.writeText(text).then(async () => {
      if (started) return;
      started = true;
      await finish(context, operation.operation_id, { copied: true, method: 'browser' });
    }).catch(() => {
      editable.select(); hint.textContent = 'Press Ctrl/Cmd+C to copy the selected text.';
    });
  }), button('Cancel', () => { void context.cancel(operation.operation_id); }));
  context.addOperationCleanup(operation.operation_id, () => shell.widget.dispose());
}

async function pasteContent(context: BrowserOperationContext, request: BrowserOperationRequest,
  operation: BrowserOperationStatus): Promise<void> {
  const accept = request.arguments.accept;
  const saveTo = request.arguments.save_to;
  if (typeof accept !== 'string' || !['text', 'image', 'text,image', 'image,text'].includes(accept) ||
      (saveTo !== null && (typeof saveTo !== 'string' || !saveTo)))
    throw new BrowserMediaError('invalid_argument', 'Invalid paste options.');
  const shell = state(context).panel('Paste into this notebook');
  const target = document.createElement('div'); target.contentEditable = 'true'; target.tabIndex = 0;
  target.setAttribute('role', 'textbox'); target.setAttribute('aria-label', 'Paste here');
  const hint = document.createElement('span');
  hint.textContent = 'Click the box and paste. Pasted content is returned to this notebook or its AI question.';
  shell.body.append(target, hint, button('Cancel', () => { void context.cancel(operation.operation_id); }));
  const pasted = await new Promise<{ text?: string; file?: File } | null>(resolve => {
    target.addEventListener('paste', event => {
      event.preventDefault();
      const image = Array.from(event.clipboardData?.items ?? []).find(item => item.type.startsWith('image/'))?.getAsFile();
      const text = event.clipboardData?.getData('text/plain') ?? '';
      if (image && accept.includes('image')) resolve({ file: image });
      else if (text && accept.includes('text')) resolve({ text });
      else hint.textContent = 'Paste plain text or one supported raster image.';
    });
    context.addOperationCleanup(operation.operation_id, () => {
      shell.widget.dispose(); resolve(null);
    });
  });
  if (pasted === null) return;
  await context.transition(operation.operation_id, 'running');
  if (pasted.text !== undefined) {
    const text = limitText(pasted.text);
    if (saveTo !== null) throw new BrowserMediaError('invalid_argument', 'Text paste cannot use save_to.');
    await context.transition(operation.operation_id, 'completed', { text });
    return;
  }
  const file = pasted.file;
  if (!file || !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type) ||
      !file.size || file.size > 50 * 1024 * 1024)
    throw new BrowserMediaError('unsupported', 'Paste one supported raster image under 50 MiB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!context.isCurrent() || context.operationSignal(operation.operation_id).aborted)
    throw new BrowserMediaError('stale_target', 'The originating notebook or paste changed.');
  await context.upload(operation.operation_id, bytes, file.type, await sha256Bytes(bytes), {}, saveTo);
}

/** Called once by the extension startup; no app/widget registration is needed. */
export function registerPlaybackOperations(): void {
  registerBrowserOperation('choose_file', chooseFile, () => ({ available: true }), { waitingForUser: true });
  registerBrowserOperation('open_media', openMedia, () => ({ available: true }));
  registerBrowserOperation('play_media', playMedia, () => ({ available: true }), { waitingForUser: true });
  registerBrowserOperation('pause_media', pauseMedia, () => ({ available: true }));
  registerBrowserOperation('seek_media', seekMedia, () => ({ available: true }));
  registerBrowserOperation('set_media_volume', volumeMedia, () => ({ available: true }));
  registerBrowserOperation('close_media', closeMedia, () => ({ available: true }));
  registerBrowserOperation('copy_text', copyText, () => ({ available: true }), { waitingForUser: true });
  registerBrowserOperation('paste_content', pasteContent, () => ({ available: true }), { waitingForUser: true });
}
