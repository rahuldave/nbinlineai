import { JupyterFrontEnd, JupyterFrontEndPlugin } from '@jupyterlab/application';
import { Dialog, ICommandPalette, ToolbarButton, showDialog } from '@jupyterlab/apputils';
import { ICellModel, MarkdownCell } from '@jupyterlab/cells';
import { INotebookTracker, NotebookActions, NotebookPanel } from '@jupyterlab/notebook';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ServerConnection } from '@jupyterlab/services';
import { addIcon } from '@jupyterlab/ui-components';
import { Widget } from '@lumino/widgets';
import { precedingCells } from './context';
import { readEventStream, StreamEvent } from './sse';
import '../style/index.css';

type Backend = 'openai_api' | 'anthropic_api';
interface CellMetadata {
  isPromptCell?: boolean;
  isOutputCell?: boolean;
  promptCellId?: string;
  backend?: Backend;
  model?: string;
  status?: string;
}
interface ProviderStatus { configured: boolean; source?: 'saved' | 'environment' | null; default_model: string; models: string[] }
interface KeyStatus { providers: Record<Backend, { configured: boolean; source: 'saved' | 'environment' | null }> }
interface Status { providers: Record<Backend, ProviderStatus>; default_models: Record<Backend, string> }
interface RunState { controller: AbortController; panel: NotebookPanel; output: ICellModel; text: string; done: boolean }
const metadataKey = 'nbinlineai';
const commandInsert = 'nbinlineai:insert-prompt-cell';
const commandRun = 'nbinlineai:run-prompt-cell';
const commandCancel = 'nbinlineai:cancel-prompt-cell';
const commandConfigure = 'nbinlineai:configure-providers';
const backends: Backend[] = ['openai_api', 'anthropic_api'];
const runs = new Map<string, RunState>();
const statuses = new Map<string, { state: string; text: string }>();
const serverSettings = ServerConnection.makeSettings();
const runKey = (panel: NotebookPanel, cellId: string): string => `${panel.id}:${cellId}`;
let settings: ISettingRegistry.ISettings | null = null;
let serverStatus: Status | null = null;
let configureDialog: Promise<void> | null = null;
let notebookTracker: INotebookTracker | null = null;

function metadata(cell: ICellModel): CellMetadata {
  return (cell.getMetadata(metadataKey) as CellMetadata | undefined) || {};
}
function isPrompt(cell: ICellModel | null | undefined): boolean {
  return !!cell && metadata(cell).isPromptCell === true;
}
function setMetadata(cell: ICellModel, patch: CellMetadata): void {
  cell.setMetadata(metadataKey, { ...metadata(cell), ...patch });
}
function defaultBackend(): Backend {
  const selected = settings?.get('defaultBackend').composite;
  return selected === 'anthropic_api' ? 'anthropic_api' : 'openai_api';
}
function modelFor(backend: Backend): string {
  const models = settings?.get('backendModels').composite as Record<string, unknown> | undefined;
  return typeof models?.[backend] === 'string' ? models[backend] as string : '';
}
function maxToolSteps(): number {
  const value = settings?.get('maxToolSteps').composite;
  return typeof value === 'number' ? value : 5;
}
function getCell(panel: NotebookPanel, id: string): ICellModel | null {
  const cells = panel.content.model?.cells;
  if (!cells) return null;
  for (let i = 0; i < cells.length; i++) if (cells.get(i).id === id) return cells.get(i);
  return null;
}
function findOutput(panel: NotebookPanel, promptId: string): ICellModel | null {
  const cells = panel.content.model?.cells;
  if (!cells) return null;
  for (let i = 0; i < cells.length; i++) {
    const cell = cells.get(i);
    const meta = metadata(cell);
    if (meta.isOutputCell && meta.promptCellId === promptId) return cell;
  }
  return null;
}
function ensureOutput(panel: NotebookPanel, promptId: string): ICellModel {
  const existing = findOutput(panel, promptId);
  if (existing) return existing;
  const model = panel.content.model;
  if (!model) throw new Error('Notebook is not ready.');
  let index = 0;
  while (index < model.cells.length && model.cells.get(index).id !== promptId) index++;
  if (index === model.cells.length) throw new Error('Prompt cell was removed.');
  model.sharedModel.insertCell(index + 1, {
    cell_type: 'markdown',
    source: '',
    metadata: { [metadataKey]: { isOutputCell: true, promptCellId: promptId } }
  });
  return model.cells.get(index + 1);
}
function status(panel: NotebookPanel, id: string, state: string, message: string): void {
  if (panel.isDisposed) return;
  statuses.set(runKey(panel, id), { state, text: message });
  const output = findOutput(panel, id);
  if (output && ['running', 'done', 'error', 'cancelled'].includes(state)) setMetadata(output, { status: state });
  decorate(panel);
}
function refreshOutput(panel: NotebookPanel, output: ICellModel): void {
  const widget = panel.content.widgets.find(cell => cell.model === output);
  if (widget instanceof MarkdownCell) {
    if (!widget.rendered) widget.rendered = true;
    widget.update();
  }
}
function appendOutput(run: RunState, value: string): void {
  run.text += value;
  run.output.sharedModel.setSource(run.text);
  refreshOutput(run.panel, run.output);
}
function serverUrl(path: string): string {
  return new URL(path, new URL(serverSettings.baseUrl, window.location.origin)).toString();
}
function authHeaders(): Headers {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (serverSettings.token) headers.set('Authorization', `token ${serverSettings.token}`);
  const xsrf = document.cookie.split('; ').find(value => value.startsWith('_xsrf='));
  if (xsrf) headers.set('X-XSRFToken', decodeURIComponent(xsrf.slice(6)));
  return headers;
}
async function fetchStatus(): Promise<void> {
  const response = await fetch(serverUrl('nbinlineai/status'), { credentials: 'same-origin', headers: authHeaders() });
  if (!response.ok) throw new Error(`Server status ${response.status}`);
  serverStatus = await response.json() as Status;
}

async function fetchKeyStatus(): Promise<KeyStatus> {
  const response = await fetch(serverUrl('nbinlineai/settings/keys'), { credentials: 'same-origin', headers: authHeaders() });
  if (!response.ok) throw new Error(`Could not load provider settings (${response.status}).`);
  return response.json() as Promise<KeyStatus>;
}

async function changeKey(backend: Backend, method: 'POST' | 'DELETE', key?: string): Promise<KeyStatus> {
  const path = method === 'POST' ? 'nbinlineai/settings/keys' : `nbinlineai/settings/keys/${backend}`;
  const response = await fetch(serverUrl(path), {
    method, credentials: 'same-origin', headers: authHeaders(),
    body: method === 'POST' ? JSON.stringify({ backend, key }) : undefined
  });
  if (!response.ok) {
    let message = `Could not ${method === 'POST' ? 'save' : 'remove'} the key (${response.status}).`;
    try {
      const result = await response.json() as { error?: string; message?: string };
      if (typeof result.message === 'string') message = result.message;
      else if (typeof result.error === 'string') message = result.error;
    } catch { /* Keep the safe status message. */ }
    throw new Error(message);
  }
  return response.json() as Promise<KeyStatus>;
}

function configureProviders(tracker: INotebookTracker): Promise<void> {
  if (configureDialog) return configureDialog;
  configureDialog = showConfigureProviders(tracker).finally(() => { configureDialog = null; });
  return configureDialog;
}

async function showConfigureProviders(tracker: INotebookTracker): Promise<void> {
  const body = new Widget();
  body.node.className = 'nbinlineai-keys-dialog';
  body.node.dataset.nbinlineaiKeysDialog = '';
  const intro = document.createElement('p');
  intro.textContent = 'Add your own API key for each provider you want to use. Saved keys stay on the computer running JupyterLab, outside notebooks, and are reused across your local Jupyter environments. Removing a saved key removes it for those environments too.';
  body.node.appendChild(intro);
  const notice = document.createElement('div');
  notice.className = 'nbinlineai-key-notice';
  notice.setAttribute('role', 'status');
  body.node.appendChild(notice);
  const rows = new Map<Backend, { input: HTMLInputElement; save: HTMLButtonElement; remove: HTMLButtonElement; status: HTMLElement }>();
  let keyStatus: KeyStatus | null = null;
  const pending = new Set<Backend>();
  const updateRows = () => {
    for (const backend of backends) {
      const row = rows.get(backend)!;
      const current = keyStatus?.providers?.[backend];
      row.status.textContent = !current ? 'Checking…' : current.source === 'saved' ? 'Saved on this computer' : current.source === 'environment' ? 'Configured by server administrator' : 'Not configured';
      row.remove.disabled = pending.has(backend) || !current || current.source !== 'saved';
      row.save.disabled = pending.has(backend) || !row.input.value.trim();
    }
  };
  for (const backend of backends) {
    const name = backend === 'openai_api' ? 'OpenAI API' : 'Anthropic API';
    const section = document.createElement('section');
    section.className = 'nbinlineai-key-provider';
    section.dataset.nbinlineaiKeyProvider = backend;
    const title = document.createElement('strong');
    title.textContent = name;
    const current = document.createElement('span');
    current.className = 'nbinlineai-key-status';
    current.dataset.nbinlineaiKeyStatus = backend;
    const input = document.createElement('input');
    input.type = 'password';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = 'Paste API key';
    input.setAttribute('aria-label', `${name} API key`);
    input.dataset.nbinlineaiKeyInput = backend;
    const save = document.createElement('button');
    save.type = 'button';
    save.textContent = 'Save';
    save.dataset.nbinlineaiKeySave = backend;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.title = 'Remove your saved key from this computer';
    remove.dataset.nbinlineaiKeyRemove = backend;
    rows.set(backend, { input, save, remove, status: current });
    input.addEventListener('input', updateRows);
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); save.click(); }
    });
    save.addEventListener('click', () => {
      const key = input.value.trim();
      if (!key || pending.has(backend)) return;
      input.value = '';
      pending.add(backend); updateRows(); notice.textContent = `Saving ${name} key…`;
      void changeKey(backend, 'POST', key).then(async result => {
        keyStatus = result;
        await fetchStatus();
        tracker.forEach(decorate);
        notice.textContent = `${name} key saved on this computer.`;
      }).catch(error => { notice.textContent = error instanceof Error ? error.message : 'Could not save key.'; }).finally(() => { pending.delete(backend); updateRows(); });
    });
    remove.addEventListener('click', () => {
      if (pending.has(backend)) return;
      pending.add(backend); updateRows(); notice.textContent = `Removing ${name} key…`;
      void changeKey(backend, 'DELETE').then(async result => {
        keyStatus = result;
        await fetchStatus();
        tracker.forEach(decorate);
        notice.textContent = `${name} saved key removed.`;
      }).catch(error => { notice.textContent = error instanceof Error ? error.message : 'Could not remove key.'; }).finally(() => { pending.delete(backend); updateRows(); });
    });
    section.append(title, current, input, save, remove);
    body.node.appendChild(section);
  }
  updateRows();
  void Promise.all([fetchKeyStatus(), fetchStatus()]).then(([result]) => {
    keyStatus = result; updateRows(); tracker.forEach(decorate);
  }).catch(error => {
    notice.textContent = error instanceof Error ? error.message : 'Could not load provider settings.';
  });
  try {
    await showDialog({ title: 'Configure AI Providers', body, buttons: [Dialog.okButton({ label: 'Done' })] });
  } finally {
    for (const row of rows.values()) row.input.value = '';
  }
}
function eventText(event: StreamEvent): string {
  return typeof event.text === 'string' ? event.text : '';
}
async function runPrompt(panel: NotebookPanel, promptId: string): Promise<void> {
  if (runs.has(runKey(panel, promptId))) return;
  const prompt = getCell(panel, promptId);
  const notebook = panel.content.model;
  if (!prompt || !isPrompt(prompt) || !notebook) return;
  const promptText = prompt.sharedModel.getSource().trim();
  if (!promptText) { status(panel, promptId, 'error', 'Write a prompt first.'); return; }
  const sessionId = panel.sessionContext.session?.id;
  if (!sessionId) { status(panel, promptId, 'error', 'Start a kernel before running this prompt.'); return; }
  const backend = metadata(prompt).backend || defaultBackend();
  if (serverStatus?.providers?.[backend]?.configured === false) {
    try { await fetchStatus(); } catch { /* The prompt request will surface a server error if unavailable. */ }
  }
  const configured = serverStatus?.providers?.[backend]?.configured;
  if (configured === false) { status(panel, promptId, 'error', `${backend === 'openai_api' ? 'OpenAI' : 'Anthropic'} API key is missing. Choose Configure AI to add it.`); return; }
  let preceding: ReturnType<typeof precedingCells>;
  try { preceding = precedingCells(notebook, promptId); }
  catch (error) { status(panel, promptId, 'error', error instanceof Error ? error.message : String(error)); return; }
  const output = ensureOutput(panel, promptId);
  output.sharedModel.setSource('');
  setMetadata(output, { status: 'running' });
  const controller = new AbortController();
  const run: RunState = { controller, panel, output, text: '', done: false };
  runs.set(runKey(panel, promptId), run);
  status(panel, promptId, 'running', 'Preparing context…');
  const selectedModel = metadata(prompt).model || modelFor(backend) || undefined;
  try {
    const response = await fetch(serverUrl('nbinlineai/prompt'), {
      method: 'POST', credentials: 'same-origin', headers: authHeaders(), signal: controller.signal,
      body: JSON.stringify({
        prompt: promptText, session_id: sessionId, prompt_cell_id: promptId,
        preceding_cells: preceding, backend, model: selectedModel, max_tool_steps: maxToolSteps()
      })
    });
    if (!response.ok) {
      const detail = await response.text();
      let message = detail;
      try {
        const parsed = JSON.parse(detail) as { message?: unknown; error?: unknown };
        if (typeof parsed.message === 'string') message = parsed.message;
        else if (typeof parsed.error === 'string') message = parsed.error;
        else if (parsed.error && typeof parsed.error === 'object' && 'message' in parsed.error) message = String(parsed.error.message);
      } catch { /* Use plain response text. */ }
      throw new Error(message.slice(0, 500) || `Server error ${response.status}`);
    }
    status(panel, promptId, 'running', 'Generating…');
    await readEventStream(response, (event: StreamEvent) => {
      if (event.type === 'text_delta') appendOutput(run, eventText(event));
      else if (event.type === 'context') {
        const count = typeof event.cell_count === 'number' ? event.cell_count : preceding.length;
        status(panel, promptId, 'running', `Using ${count} preceding cells…`);
      } else if (event.type === 'tool_start') status(panel, promptId, 'running', `Running ${String(event.name || 'tool')}…`);
      else if (event.type === 'tool_result') status(panel, promptId, 'running', `${String(event.name || 'Tool')} completed; generating…`);
      else if (event.type === 'error') throw new Error(String(event.message || 'AI request failed.'));
      else if (event.type === 'done') run.done = true;
    });
    if (!run.done) throw new Error('The response ended before completion.');
    refreshOutput(panel, output);
    status(panel, promptId, 'done', 'Done');
  } catch (error) {
    if (controller.signal.aborted) {
      status(panel, promptId, 'cancelled', 'Cancelled');
    } else {
      const message = error instanceof Error ? error.message : String(error);
      status(panel, promptId, 'error', message);
      if (!run.text) { output.sharedModel.setSource(`**AI error:** ${message}`); refreshOutput(panel, output); }
    }
  } finally {
    runs.delete(runKey(panel, promptId));
    decorate(panel);
  }
}
function cancelPrompt(panel: NotebookPanel, promptId: string): void {
  runs.get(runKey(panel, promptId))?.controller.abort();
  status(panel, promptId, 'cancelled', 'Cancelling…');
}
function insertPrompt(panel: NotebookPanel): void {
  const notebook = panel.content;
  NotebookActions.insertBelow(notebook);
  NotebookActions.changeCellType(notebook, 'markdown');
  const cell = notebook.activeCell;
  if (!cell) return;
  setMetadata(cell.model, { isPromptCell: true });
  cell.model.sharedModel.setSource('');
  notebook.mode = 'edit';
  decorate(panel);
}
function makeControls(panel: NotebookPanel, id: string): HTMLElement {
  const controls = document.createElement('div');
  controls.className = 'nbinlineai-controls';
  controls.dataset.nbinlineaiPromptId = id;
  const provider = document.createElement('select');
  provider.dataset.nbinlineaiProvider = '';
  provider.setAttribute('aria-label', 'AI provider');
  for (const backend of backends) {
    const option = document.createElement('option');
    option.value = backend;
    option.textContent = backend === 'openai_api' ? 'OpenAI API' : 'Anthropic API';
    provider.appendChild(option);
  }
  const prompt = getCell(panel, id);
  provider.value = prompt && metadata(prompt).backend || defaultBackend();
  const modelInput = document.createElement('input');
  modelInput.dataset.nbinlineaiModel = '';
  modelInput.setAttribute('aria-label', 'AI model');
  modelInput.placeholder = 'Server default model';
  modelInput.value = prompt && metadata(prompt).model || '';
  const updateModelHint = () => {
    const backend = provider.value as Backend;
    const info = serverStatus?.providers?.[backend];
    modelInput.placeholder = modelFor(backend) || info?.default_model || serverStatus?.default_models?.[backend] || 'Server default model';
    modelInput.title = info?.models?.length ? `Known models: ${info.models.join(', ')}` : 'Blank uses the server default model';
  };
  updateModelHint();
  provider.addEventListener('change', () => {
    const cell = getCell(panel, id);
    if (cell) setMetadata(cell, { backend: provider.value as Backend, model: '' });
    modelInput.value = '';
    updateModelHint();
  });
  modelInput.addEventListener('change', () => { const cell = getCell(panel, id); if (cell) setMetadata(cell, { model: modelInput.value.trim() }); });
  const run = document.createElement('button');
  run.dataset.nbinlineaiRun = '';
  run.textContent = 'Run AI';
  run.title = 'Run AI prompt (Shift+Enter)';
  run.addEventListener('click', () => { void runPrompt(panel, id); });
  const cancel = document.createElement('button');
  cancel.dataset.nbinlineaiCancel = '';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => cancelPrompt(panel, id));
  const configure = document.createElement('button');
  configure.dataset.nbinlineaiConfigure = '';
  configure.textContent = 'Configure AI';
  configure.addEventListener('click', () => { if (notebookTracker) void configureProviders(notebookTracker); });
  const label = document.createElement('span');
  label.className = 'nbinlineai-status';
  label.setAttribute('role', 'status');
  controls.append(provider, modelInput, run, cancel, configure, label);
  return controls;
}
function decorate(panel: NotebookPanel): void {
  if (panel.isDisposed) return;
  for (const widget of panel.content.widgets) {
    const cell = widget.model;
    const meta = metadata(cell);
    widget.toggleClass('nbinlineai-prompt-cell', !!meta.isPromptCell);
    widget.toggleClass('nbinlineai-output-cell', !!meta.isOutputCell);
    widget.toggleClass('nbinlineai-response-cell', !!meta.isOutputCell);
    if (meta.isOutputCell && widget instanceof MarkdownCell && !widget.rendered) widget.rendered = true;
    if (!meta.isPromptCell) { widget.node.querySelector(':scope > .nbinlineai-controls')?.remove(); continue; }
    let controls = widget.node.querySelector(':scope > .nbinlineai-controls') as HTMLElement | null;
    if (!controls) { controls = makeControls(panel, cell.id); widget.node.appendChild(controls); }
    const selectedProvider = controls.querySelector('[data-nbinlineai-provider]') as HTMLSelectElement;
    selectedProvider.value = meta.backend || defaultBackend();
    const selectedModel = controls.querySelector('[data-nbinlineai-model]') as HTMLInputElement;
    if (document.activeElement !== selectedModel) selectedModel.value = meta.model || '';
    const backend = selectedProvider.value as Backend;
    selectedModel.placeholder = modelFor(backend) || serverStatus?.providers?.[backend]?.default_model || serverStatus?.default_models?.[backend] || 'Server default model';
    const running = runs.has(runKey(panel, cell.id));
    const runButton = controls.querySelector('[data-nbinlineai-run]') as HTMLButtonElement;
    const cancelButton = controls.querySelector('[data-nbinlineai-cancel]') as HTMLButtonElement;
    runButton.disabled = running;
    cancelButton.disabled = !running;
    const label = controls.querySelector('.nbinlineai-status') as HTMLElement;
    const current = statuses.get(runKey(panel, cell.id));
    label.dataset.state = current?.state || 'idle';
    label.textContent = current?.text || '';
  }
}
const plugin: JupyterFrontEndPlugin<void> = {
  id: 'nbinlineai:plugin', autoStart: true, requires: [INotebookTracker], optional: [ICommandPalette, ISettingRegistry],
  activate: (app: JupyterFrontEnd, tracker: INotebookTracker, palette: ICommandPalette | null, registry: ISettingRegistry | null) => {
    notebookTracker = tracker;
    if (registry) void registry.load(plugin.id).then(value => {
      settings = value;
      settings.changed.connect(() => tracker.forEach(decorate));
      tracker.forEach(decorate);
    }).catch(console.error);
    void fetchStatus().then(() => tracker.forEach(decorate)).catch(error => console.warn('nbinlineai status unavailable:', error));
    app.commands.addCommand(commandInsert, { label: 'Insert AI Prompt Cell', execute: () => { const panel = tracker.currentWidget; if (panel) insertPrompt(panel); } });
    app.commands.addCommand(commandRun, { label: 'Run AI Prompt Cell', isEnabled: () => isPrompt(tracker.currentWidget?.content.activeCell?.model), execute: () => {
      const panel = tracker.currentWidget; const id = panel?.content.activeCell?.model.id;
      if (panel && id) return runPrompt(panel, id);
    } });
    app.commands.addCommand(commandCancel, { label: 'Cancel AI Prompt Cell', isEnabled: () => !!tracker.currentWidget?.content.activeCell && runs.has(runKey(tracker.currentWidget, tracker.currentWidget.content.activeCell.model.id)), execute: () => {
      const panel = tracker.currentWidget; const id = panel?.content.activeCell?.model.id;
      if (panel && id) cancelPrompt(panel, id);
    } });
    app.commands.addCommand(commandConfigure, { label: 'Configure AI Providers', execute: () => configureProviders(tracker) });
    for (const command of [commandInsert, commandRun, commandCancel, commandConfigure]) palette?.addItem({ command, category: 'AI' });
    const setup = (panel: NotebookPanel) => {
      void panel.context.ready.then(() => {
        if (panel.isDisposed) return;
        const configureButton = new ToolbarButton({ label: 'Configure AI', tooltip: 'Add or remove API keys', onClick: () => { void configureProviders(tracker); } });
        panel.toolbar.addItem('nbinlineai-configure', configureButton);
        const insertButton = new ToolbarButton({ icon: addIcon, label: 'AI Prompt', tooltip: 'Insert AI Prompt Cell', onClick: () => insertPrompt(panel) });
        if (!panel.toolbar.insertAfter('cellType', 'nbinlineai-insert', insertButton)) {
          panel.toolbar.addItem('nbinlineai-insert', insertButton);
        }
        decorate(panel);
        panel.content.activeCellChanged.connect(() => decorate(panel));
        panel.content.model?.cells.changed.connect(() => { window.requestAnimationFrame(() => decorate(panel)); });
        panel.content.node.addEventListener('keydown', event => {
          if (event.key !== 'Enter' || !event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
          const cell = panel.content.activeCell;
          if (!cell || !isPrompt(cell.model)) return;
          event.preventDefault(); event.stopImmediatePropagation();
          void runPrompt(panel, cell.model.id);
        }, true);
        const observer = new MutationObserver(records => {
          if (records.some(record => Array.from(record.addedNodes).some(node =>
            node instanceof Element && (node.matches('.jp-Cell') || !!node.querySelector('.jp-Cell'))
          ))) decorate(panel);
        });
        observer.observe(panel.content.node, { childList: true, subtree: true });
        panel.disposed.connect(() => {
          observer.disconnect();
          for (const [key, run] of runs) if (key.startsWith(`${panel.id}:`)) { run.controller.abort(); runs.delete(key); }
          for (const key of statuses.keys()) if (key.startsWith(`${panel.id}:`)) statuses.delete(key);
        });
      });
    };
    tracker.widgetAdded.connect((_, panel) => setup(panel));
    tracker.forEach(setup);
  }
};
export default plugin;
