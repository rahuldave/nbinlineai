import { JupyterFrontEnd, JupyterFrontEndPlugin } from '@jupyterlab/application';
import { Dialog, ICommandPalette, ToolbarButton, showDialog } from '@jupyterlab/apputils';
import { ICellModel, MarkdownCell } from '@jupyterlab/cells';
import { INotebookTracker, NotebookActions, NotebookPanel } from '@jupyterlab/notebook';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ServerConnection } from '@jupyterlab/services';
import { addIcon, copyIcon } from '@jupyterlab/ui-components';
import { Widget } from '@lumino/widgets';
import { precedingCells } from './context';
import { copyCodeText } from './codeCopy';
import { availableModels, CUSTOM_MODEL, DEFAULT_MODEL, resolvedDefault, selectedModelChoice, promptHttpErrorMessage, serverUnavailableMessage } from './modelChoice';
import { cellProvider, configured } from './providerChoice';
import { promptMode as normalizePromptMode, promptModeLabel, PromptMode } from './promptMode';
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
let settingRegistry: ISettingRegistry | null = null;
let settingsReady: Promise<void> = Promise.resolve();
let settingsError: string | null = null;
let settingsWarning: string | null = null;
let confirmedPromptMode: PromptMode = 'compact';
let modeSavePending = false;
let serverStatus: Status | null = null;
let serverStatusError: string | null = null;
let configureDialog: Promise<void> | null = null;
let notebookTracker: INotebookTracker | null = null;
class EndpointUnavailableError extends Error {}

function metadata(cell: ICellModel): CellMetadata {
  return (cell.getMetadata(metadataKey) as CellMetadata | undefined) || {};
}
function isPrompt(cell: ICellModel | null | undefined): boolean {
  return !!cell && metadata(cell).isPromptCell === true;
}
function setMetadata(cell: ICellModel, patch: CellMetadata): void {
  cell.setMetadata(metadataKey, { ...metadata(cell), ...patch });
}
function preferredBackend(): Backend {
  const selected = settings?.get('defaultBackend').composite;
  return selected === 'anthropic_api' ? 'anthropic_api' : 'openai_api';
}
function modelFor(backend: Backend): string {
  const models = settings?.get('backendModels').composite as Record<string, unknown> | undefined;
  return typeof models?.[backend] === 'string' ? models[backend] as string : '';
}
function currentPromptMode(): PromptMode {
  return confirmedPromptMode;
}
function onResponseSettingsChanged(): void {
  if (!modeSavePending) confirmedPromptMode = normalizePromptMode(settings?.get('promptMode').composite);
  notebookTracker?.forEach(decorate);
}
function bindResponseSettings(value: ISettingRegistry.ISettings): void {
  settings?.changed.disconnect(onResponseSettingsChanged);
  settings = value;
  settingsError = null;
  settingsWarning = null;
  confirmedPromptMode = normalizePromptMode(value.get('promptMode').composite);
  settings.changed.connect(onResponseSettingsChanged);
  notebookTracker?.forEach(decorate);
}
async function reloadResponseSettings(): Promise<void> {
  if (!settingRegistry) throw new Error('JupyterLab response style settings service is unavailable.');
  try {
    bindResponseSettings(await settingRegistry.reload(plugin.id));
  } catch (error) {
    const message = `Could not reload response style settings: ${error instanceof Error ? error.message : String(error)}`;
    if (settings) settingsWarning = message;
    else settingsError = message;
    notebookTracker?.forEach(decorate);
    throw error;
  }
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
function decorateCodeCopy(widget: MarkdownCell): void {
  for (const code of Array.from(widget.node.querySelectorAll<HTMLElement>('.jp-RenderedHTMLCommon pre > code'))) {
    const pre = code.parentElement;
    if (!pre || pre.querySelector(':scope > [data-nbinlineai-copy-code]')) continue;
    pre.classList.add('nbinlineai-code-block');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'nbinlineai-copy-code';
    button.dataset.nbinlineaiCopyCode = '';
    button.setAttribute('aria-label', 'Copy code');
    button.title = 'Copy code to clipboard';
    const label = document.createElement('span');
    label.textContent = 'Copy';
    button.append(copyIcon.element(), label);
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      button.disabled = true;
      void copyCodeText(code, async value => {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(value);
      }).then(() => {
        label.textContent = 'Copied';
        button.dataset.state = 'copied';
        button.setAttribute('aria-label', 'Copied');
        button.title = 'Code copied to clipboard';
      }).catch(() => {
        label.textContent = 'Copy failed';
        button.dataset.state = 'error';
        button.setAttribute('aria-label', 'Copy failed');
        button.title = 'Clipboard unavailable; select the code to copy manually';
      }).finally(() => { button.disabled = false; });
    });
    pre.appendChild(button);
  }
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
  try {
    const response = await fetch(serverUrl('nbinlineai/status'), { credentials: 'same-origin', headers: authHeaders() });
    if (response.status === 404) throw new EndpointUnavailableError(serverUnavailableMessage('prompt'));
    if (!response.ok) throw new Error(`AI server status ${response.status}`);
    serverStatus = await response.json() as Status;
    serverStatusError = null;
  } catch (error) {
    serverStatusError = error instanceof Error ? error.message : 'Could not reach the AI server.';
    throw error;
  }
}

async function fetchKeyStatus(): Promise<KeyStatus> {
  const response = await fetch(serverUrl('nbinlineai/settings/keys'), { credentials: 'same-origin', headers: authHeaders() });
  if (response.status === 404) throw new EndpointUnavailableError(serverUnavailableMessage('settings'));
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
    if (response.status === 404) throw new EndpointUnavailableError(serverUnavailableMessage('settings'));
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

function mergeKeyStatus(result: KeyStatus): void {
  if (!serverStatus) return;
  for (const backend of backends) {
    const key = result.providers?.[backend];
    const provider = serverStatus.providers?.[backend];
    if (key && provider) serverStatus.providers[backend] = { ...provider, configured: key.configured, source: key.source };
  }
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
  const styleHeading = document.createElement('h3');
  styleHeading.textContent = 'Response style';
  const styleSelect = document.createElement('select');
  styleSelect.dataset.nbinlineaiPromptMode = '';
  styleSelect.setAttribute('aria-label', 'Response style');
  styleSelect.disabled = true;
  for (const [value, label] of [
    ['compact', 'Compact — very succinct'],
    ['full', 'Full — detailed explanations and code'],
    ['learning', 'Learning — questions, up to three lines of code, no full solutions']
  ]) {
    const option = document.createElement('option');
    option.value = value; option.textContent = label; styleSelect.appendChild(option);
  }
  const styleDescription = document.createElement('p');
  styleDescription.className = 'nbinlineai-style-description';
  styleDescription.textContent = 'Applies to every next AI run, including reruns. Learning guides you with questions and at most three lines of code in brief hints, without a full solution.';
  const styleNotice = document.createElement('div');
  styleNotice.className = 'nbinlineai-style-notice';
  styleNotice.setAttribute('role', 'status');
  styleNotice.textContent = 'Loading response style settings…';
  const styleRetry = document.createElement('button');
  styleRetry.type = 'button';
  styleRetry.textContent = 'Retry response style settings';
  styleRetry.dataset.nbinlineaiStyleRetry = '';
  styleRetry.hidden = true;
  styleRetry.addEventListener('click', () => {
    styleRetry.disabled = true;
    styleNotice.textContent = 'Reloading response style settings…';
    void reloadResponseSettings().then(() => {
      styleSelect.value = currentPromptMode();
      styleSelect.disabled = false;
      styleRetry.hidden = true;
      styleNotice.textContent = `${promptModeLabel(currentPromptMode())} is the current response style.`;
    }).catch(() => {
      styleSelect.disabled = true;
      styleNotice.textContent = settingsError || settingsWarning || 'Could not reload response style settings. Choose Retry.';
    }).finally(() => { styleRetry.disabled = false; });
  });
  body.node.append(styleHeading, styleSelect, styleDescription, styleNotice, styleRetry);
  void settingsReady.then(() => {
    if (settingsError || !settings) {
      styleNotice.textContent = settingsError || 'Response style settings are unavailable.';
      styleRetry.hidden = !settingRegistry;
      return;
    }
    styleSelect.value = currentPromptMode();
    styleSelect.disabled = false;
    styleRetry.hidden = !settingsWarning;
    styleNotice.textContent = settingsWarning || '';
  });
  styleSelect.addEventListener('change', () => {
    const chosen = normalizePromptMode(styleSelect.value);
    const previous = currentPromptMode();
    if (!settings) {
      styleSelect.value = previous;
      styleNotice.textContent = 'Response style settings are unavailable. Nothing was saved.';
      return;
    }
    styleSelect.disabled = true;
    modeSavePending = true;
    styleNotice.textContent = 'Saving response style…';
    void settings.set('promptMode', chosen).then(() => {
      const authoritative = normalizePromptMode(settings?.get('promptMode').composite);
      confirmedPromptMode = authoritative;
      styleSelect.value = authoritative;
      settingsWarning = authoritative === chosen ? null : 'Saved response style differs from the requested style.';
      styleRetry.hidden = !settingsWarning;
      styleNotice.textContent = authoritative === chosen
        ? `${promptModeLabel(chosen)} will apply to your next AI run and reruns.`
        : `The saved response style is ${promptModeLabel(authoritative)}. Choose Retry response style settings to check it.`;
      tracker.forEach(decorate);
    }).catch(() => {
      confirmedPromptMode = previous;
      styleSelect.value = previous;
      settingsWarning = 'Could not confirm the response style save.';
      styleRetry.hidden = false;
      styleNotice.textContent = 'Could not confirm the response style save. Choose Retry response style settings to check what was saved.';
      tracker.forEach(decorate);
    }).finally(() => { modeSavePending = false; styleSelect.disabled = false; });
  });
  const keysHeading = document.createElement('h3');
  keysHeading.textContent = 'API keys';
  body.node.appendChild(keysHeading);
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
  let keysAvailable = false;
  let keyLoadFailed = false;
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = 'Retry';
  retry.dataset.nbinlineaiKeyRetry = '';
  retry.hidden = true;
  body.node.appendChild(retry);
  const updateRows = () => {
    for (const backend of backends) {
      const row = rows.get(backend)!;
      const current = keyStatus?.providers?.[backend];
      row.status.textContent = keyLoadFailed ? 'Settings unavailable' : !current ? 'Checking…' : current.source === 'saved' ? 'Saved on this computer' : current.source === 'environment' ? 'Configured by server administrator' : 'Not configured';
      row.remove.disabled = !keysAvailable || pending.has(backend) || !current || current.source !== 'saved';
      row.save.disabled = !keysAvailable || pending.has(backend) || !row.input.value.trim();
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
      if (!key || !keysAvailable || pending.has(backend)) return;
      input.value = '';
      pending.add(backend); updateRows(); notice.textContent = `Saving ${name} key…`;
      void changeKey(backend, 'POST', key).then(async result => {
        keyStatus = result;
        mergeKeyStatus(result);
        tracker.forEach(decorate);
        let refreshed = true;
        try { await fetchStatus(); } catch { refreshed = false; retry.hidden = false; }
        tracker.forEach(decorate);
        notice.textContent = refreshed
          ? `${name} key saved on this computer.`
          : `${name} key saved on this computer. Provider status could not refresh; choose Retry.`;
      }).catch(error => {
        if (error instanceof EndpointUnavailableError) { keysAvailable = false; keyLoadFailed = true; retry.hidden = false; }
        notice.textContent = error instanceof Error ? error.message : 'Could not save key.';
      }).finally(() => { pending.delete(backend); updateRows(); });
    });
    remove.addEventListener('click', () => {
      if (!keysAvailable || pending.has(backend)) return;
      pending.add(backend); updateRows(); notice.textContent = `Removing ${name} key…`;
      void changeKey(backend, 'DELETE').then(async result => {
        keyStatus = result;
        mergeKeyStatus(result);
        tracker.forEach(decorate);
        let refreshed = true;
        try { await fetchStatus(); } catch { refreshed = false; retry.hidden = false; }
        tracker.forEach(decorate);
        notice.textContent = refreshed
          ? `${name} saved key removed.`
          : `${name} saved key removed. Provider status could not refresh; choose Retry.`;
      }).catch(error => {
        if (error instanceof EndpointUnavailableError) { keysAvailable = false; keyLoadFailed = true; retry.hidden = false; }
        notice.textContent = error instanceof Error ? error.message : 'Could not remove key.';
      }).finally(() => { pending.delete(backend); updateRows(); });
    });
    section.append(title, current, input, save, remove);
    body.node.appendChild(section);
  }
  const loadKeys = async () => {
    retry.disabled = true;
    notice.textContent = 'Checking provider settings…';
    try {
      keyStatus = await fetchKeyStatus();
      mergeKeyStatus(keyStatus);
      keysAvailable = true;
      keyLoadFailed = false;
      tracker.forEach(decorate);
      try {
        await fetchStatus();
        retry.hidden = true;
        notice.textContent = '';
      } catch (error) {
        retry.hidden = false;
        notice.textContent = error instanceof Error ? error.message : 'Could not refresh provider status. Choose Retry.';
      }
      tracker.forEach(decorate);
    } catch (error) {
      keysAvailable = false;
      keyLoadFailed = true;
      retry.hidden = false;
      notice.textContent = error instanceof Error ? error.message : 'Could not load provider settings. Try again.';
    } finally {
      retry.disabled = false;
      updateRows();
    }
  };
  retry.addEventListener('click', () => { void loadKeys(); });
  updateRows();
  void loadKeys();
  try {
    await showDialog({ title: 'Configure AI', body, buttons: [Dialog.okButton({ label: 'Done' })] });
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
  await settingsReady;
  if (!settings) { status(panel, promptId, 'error', settingsError || 'Response style settings are unavailable. Open Configure AI and retry.'); return; }
  const mode = currentPromptMode();
  if (!serverStatus || serverStatusError || serverStatus?.providers?.[cellProvider(metadata(prompt).backend, preferredBackend(), serverStatus.providers)]?.configured === false) {
    try { await fetchStatus(); }
    catch (error) { status(panel, promptId, 'error', error instanceof Error ? error.message : 'Could not reach the AI server.'); return; }
  }
  const backend = cellProvider(metadata(prompt).backend, preferredBackend(), serverStatus?.providers || null);
  const available = configured(serverStatus?.providers || null, backend);
  if (available === false) { status(panel, promptId, 'error', 'API key required. Choose Configure AI or another provider.'); return; }
  if (!metadata(prompt).backend) setMetadata(prompt, { backend });
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
        preceding_cells: preceding, backend, model: selectedModel, max_tool_steps: maxToolSteps(), prompt_mode: mode
      })
    });
    if (!response.ok) {
      const message = promptHttpErrorMessage(response.status);
      if (response.status === 404) throw new EndpointUnavailableError(message);
      throw new Error(message);
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
      if (!run.text) {
        output.sharedModel.setSource(error instanceof EndpointUnavailableError
          ? '**AI server endpoint unavailable.** Check the status beside the prompt for recovery steps.'
          : '**AI request failed.** Check the status beside the prompt for details.');
        refreshOutput(panel, output);
      }
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
function syncModelControls(controls: HTMLElement, backend: Backend, savedModel: string): void {
  const select = controls.querySelector('[data-nbinlineai-model-select]') as HTMLSelectElement;
  const input = controls.querySelector('[data-nbinlineai-model]') as HTMLInputElement;
  const models = availableModels(serverStatus?.providers?.[backend]?.models);
  const defaultId = resolvedDefault(modelFor(backend), serverStatus?.providers?.[backend]?.default_model || serverStatus?.default_models?.[backend]);
  const signature = JSON.stringify([backend, defaultId, models]);
  if (select.dataset.optionsSignature !== signature) {
    select.replaceChildren();
    const defaultOption = document.createElement('option');
    defaultOption.value = DEFAULT_MODEL;
    defaultOption.textContent = defaultId ? `Default (${defaultId})` : 'Default (server model)';
    select.appendChild(defaultOption);
    for (const model of models) {
      const option = document.createElement('option');
      option.value = model;
      option.textContent = model;
      select.appendChild(option);
    }
    const customOption = document.createElement('option');
    customOption.value = CUSTOM_MODEL;
    customOption.textContent = 'Custom model…';
    select.appendChild(customOption);
    select.dataset.optionsSignature = signature;
  }
  const savedChoice = selectedModelChoice(savedModel, models);
  if (!(select.dataset.customActive === 'true' && savedChoice === DEFAULT_MODEL && select.value === CUSTOM_MODEL)) {
    select.value = savedChoice;
  }
  input.hidden = select.value !== CUSTOM_MODEL;
  if (document.activeElement !== input) input.value = select.value === CUSTOM_MODEL ? savedModel : '';
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
  provider.value = cellProvider(prompt ? metadata(prompt).backend : undefined, preferredBackend(), serverStatus?.providers || null);
  const modelSelect = document.createElement('select');
  modelSelect.dataset.nbinlineaiModelSelect = '';
  modelSelect.setAttribute('aria-label', 'AI model');
  const modelInput = document.createElement('input');
  modelInput.dataset.nbinlineaiModel = '';
  modelInput.setAttribute('aria-label', 'Custom AI model ID');
  modelInput.placeholder = 'Enter model ID';
  modelInput.hidden = true;
  provider.addEventListener('change', () => {
    const cell = getCell(panel, id);
    if (cell) setMetadata(cell, { backend: provider.value as Backend, model: '' });
    modelSelect.dataset.customActive = 'false';
    syncModelControls(controls, provider.value as Backend, '');
    decorate(panel);
  });
  modelSelect.addEventListener('change', () => {
    const cell = getCell(panel, id);
    if (!cell) return;
    if (modelSelect.value === CUSTOM_MODEL) {
      modelSelect.dataset.customActive = 'true';
      setMetadata(cell, { backend: provider.value as Backend, model: modelInput.value.trim() });
      syncModelControls(controls, provider.value as Backend, modelInput.value.trim());
      modelInput.focus();
    } else {
      modelSelect.dataset.customActive = 'false';
      setMetadata(cell, { backend: provider.value as Backend, model: modelSelect.value === DEFAULT_MODEL ? '' : modelSelect.value });
      syncModelControls(controls, provider.value as Backend, metadata(cell).model || '');
    }
  });
  modelInput.addEventListener('input', () => {
    const cell = getCell(panel, id);
    if (cell) setMetadata(cell, { backend: provider.value as Backend, model: modelInput.value.trim() });
  });
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
  const modeLabel = document.createElement('span');
  modeLabel.dataset.nbinlineaiCurrentMode = '';
  modeLabel.className = 'nbinlineai-current-mode';
  modeLabel.title = 'Set in Configure AI; applies to the next run and reruns';
  const label = document.createElement('span');
  label.className = 'nbinlineai-status';
  label.setAttribute('role', 'status');
  controls.append(provider, modelSelect, modelInput, run, cancel, configure, modeLabel, label);
  syncModelControls(controls, provider.value as Backend, prompt && metadata(prompt).model || '');
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
    if (meta.isOutputCell && widget instanceof MarkdownCell) {
      if (!widget.rendered) widget.rendered = true;
      decorateCodeCopy(widget);
    }
    if (!meta.isPromptCell) { widget.node.querySelector(':scope > .nbinlineai-controls')?.remove(); continue; }
    let controls = widget.node.querySelector(':scope > .nbinlineai-controls') as HTMLElement | null;
    if (!controls) { controls = makeControls(panel, cell.id); widget.node.appendChild(controls); }
    const selectedProvider = controls.querySelector('[data-nbinlineai-provider]') as HTMLSelectElement;
    selectedProvider.value = cellProvider(meta.backend, preferredBackend(), serverStatus?.providers || null);
    const availableCount = backends.filter(backend => configured(serverStatus?.providers || null, backend)).length;
    for (const option of Array.from(selectedProvider.options)) {
      const backend = option.value as Backend;
      const usable = configured(serverStatus?.providers || null, backend);
      option.disabled = usable === false;
      option.textContent = `${backend === 'openai_api' ? 'OpenAI API' : 'Anthropic API'}${usable === false ? ' — API key required' : ''}`;
    }
    selectedProvider.disabled = !serverStatus || availableCount === 0;
    syncModelControls(controls, selectedProvider.value as Backend, meta.model || '');
    const selectedAvailability = configured(serverStatus?.providers || null, selectedProvider.value as Backend);
    const modelSelect = controls.querySelector('[data-nbinlineai-model-select]') as HTMLSelectElement;
    const customInput = controls.querySelector('[data-nbinlineai-model]') as HTMLInputElement;
    modelSelect.disabled = selectedAvailability !== true;
    customInput.disabled = selectedAvailability !== true;
    const running = runs.has(runKey(panel, cell.id));
    const runButton = controls.querySelector('[data-nbinlineai-run]') as HTMLButtonElement;
    const cancelButton = controls.querySelector('[data-nbinlineai-cancel]') as HTMLButtonElement;
    runButton.disabled = running || selectedAvailability === false;
    cancelButton.disabled = !running;
    const modeLabel = controls.querySelector('[data-nbinlineai-current-mode]') as HTMLElement;
    modeLabel.textContent = settingsError || `${promptModeLabel(currentPromptMode())} responses${settingsWarning ? ' · settings unconfirmed' : ''}`;
    const label = controls.querySelector('.nbinlineai-status') as HTMLElement;
    const key = runKey(panel, cell.id);
    let current = statuses.get(key);
    if (selectedAvailability === true && current?.state === 'error' && current.text.startsWith('API key required.')) {
      statuses.delete(key);
      current = undefined;
    }
    const availabilityNotice = selectedAvailability === false
      ? availableCount === 0 ? 'No API key configured. Choose Configure AI.' : 'API key required. Choose Configure AI or another provider.'
      : '';
    label.dataset.state = serverStatusError ? 'error' : selectedAvailability === false ? 'error' : current?.state || 'idle';
    label.textContent = serverStatusError || (current?.state === 'running' ? current.text : '') || availabilityNotice || current?.text || (serverStatus ? '' : 'Checking AI providers…');
  }
}
const plugin: JupyterFrontEndPlugin<void> = {
  id: 'nbinlineai:plugin', autoStart: true, requires: [INotebookTracker], optional: [ICommandPalette, ISettingRegistry],
  activate: (app: JupyterFrontEnd, tracker: INotebookTracker, palette: ICommandPalette | null, registry: ISettingRegistry | null) => {
    notebookTracker = tracker;
    settingRegistry = registry;
    if (registry) settingsReady = registry.load(plugin.id).then(bindResponseSettings).catch(error => {
      settingsError = `Could not load response style settings: ${error instanceof Error ? error.message : String(error)}`;
      tracker.forEach(decorate);
    });
    else settingsError = 'JupyterLab response style settings are unavailable.';
    void fetchStatus().then(() => tracker.forEach(decorate)).catch(error => { console.warn('nbinlineai status unavailable:', error); tracker.forEach(decorate); });
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
            node instanceof Element && (node.matches('.jp-Cell, pre, pre > code') || !!node.querySelector('.jp-Cell, pre > code'))
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
