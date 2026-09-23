import { JupyterFrontEnd, JupyterFrontEndPlugin } from '@jupyterlab/application';
import { Dialog, ICommandPalette, ToolbarButton, showDialog } from '@jupyterlab/apputils';
import { ICellModel, MarkdownCell } from '@jupyterlab/cells';
import { INotebookCellExecutor, INotebookModel, INotebookTracker, NotebookActions, NotebookPanel } from '@jupyterlab/notebook';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ServerConnection } from '@jupyterlab/services';
import { addIcon, copyIcon } from '@jupyterlab/ui-components';
import { Widget } from '@lumino/widgets';
import { precedingCells } from './context';
import { copyCodeText } from './codeCopy';
import { availableModels, CUSTOM_MODEL, DEFAULT_MODEL, resolvedDefault, selectedModelChoice, promptHttpErrorMessage, serverUnavailableMessage } from './modelChoice';
import { configured, defaultProvider } from './providerChoice';
import { promptMode as normalizePromptMode, promptModeLabel, PromptMode } from './promptMode';
import { AIDefaults, hasOverride, resolveAI, snapshotDefaults, supportedEffort } from './defaults';
import { effectiveKeepAnswer, keepsCompletedAnswer } from './keepAnswer';
import { enqueueNotebookCell } from './executionQueue';
import { readEventStream, StreamEvent } from './sse';
import { NotebookActionBridge } from './frontendActions';
import { ContextReport, completedContextText, contextTooltip, contextWasTrimmed, parseContextReport, runningContextText, runningProgressText } from './contextStatus';
import { runTrackedStandardCell } from './insertTools';
import '../style/index.css';

type Backend = 'openai_api' | 'anthropic_api';
interface CellMetadata {
  isPromptCell?: boolean;
  isOutputCell?: boolean;
  promptCellId?: string;
  backend?: Backend;
  model?: string;
  promptMode?: PromptMode;
  reasoningEffort?: string;
  keepAnswer?: boolean;
  status?: string;
}
interface ProviderStatus { configured: boolean; source?: 'saved' | 'environment' | null; default_model: string; models: string[] }
interface KeyStatus { providers: Record<Backend, { configured: boolean; source: 'saved' | 'environment' | null }> }
interface Status { providers: Record<Backend, ProviderStatus>; default_models: Record<Backend, string>; prompt_mode_instructions?: Record<PromptMode, string>; model_capabilities?: Record<Backend, Record<string, { efforts: string[]; default_effort: string | null }>> }
interface RunState { controller: AbortController; panel: NotebookPanel; output: ICellModel; text: string; done: boolean; context: ContextReport | null; contextTrimmed: boolean }
const metadataKey = 'nbinlineai';
const commandInsert = 'nbinlineai:insert-prompt-cell';
const commandRun = 'nbinlineai:run-prompt-cell';
const commandCancel = 'nbinlineai:cancel-prompt-cell';
const commandConfigure = 'nbinlineai:configure-providers';
const backends: Backend[] = ['openai_api', 'anthropic_api'];
const runs = new Map<string, RunState>();
const pendingPromptRuns = new Map<string, Promise<boolean>>();
const pendingCancels = new Set<string>();
const panelsByModel = new WeakMap<INotebookModel, NotebookPanel>();
const statuses = new Map<string, { state: string; text: string; tooltip?: string }>();
const pendingSnapshots = new Set<NotebookPanel>();
const serverSettings = ServerConnection.makeSettings();
const runKey = (panel: NotebookPanel, cellId: string): string => `${panel.id}:${cellId}`;
let settings: ISettingRegistry.ISettings | null = null;
let settingRegistry: ISettingRegistry | null = null;
let settingsReady: Promise<void> = Promise.resolve();
let settingsError: string | null = null;
let settingsWarning: string | null = null;
let confirmedPromptMode: PromptMode = 'compact';
let modeSavePending = false;
let instructionsSavePending = false;
let confirmedInstructions: Partial<Record<PromptMode, string>> = {};
let instructionNotices: Partial<Record<PromptMode, string>> = {};
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
function readInstructionOverrides(value: unknown): Partial<Record<PromptMode, string>> {
  if (!value || typeof value !== 'object') return {};
  const raw = value as Record<string, unknown>;
  const result: Partial<Record<PromptMode, string>> = {};
  for (const mode of ['compact', 'full', 'learning'] as PromptMode[]) {
    const instruction = raw[mode];
    if (typeof instruction === 'string' && instruction.trim() && instruction.length <= 8000) result[mode] = instruction;
  }
  return result;
}
function notebookDefaults(panel: NotebookPanel): AIDefaults {
  const raw = panel.content.model?.getMetadata(metadataKey) as { defaults?: AIDefaults } | undefined;
  return raw?.defaults || {};
}
function setNotebookDefaults(panel: NotebookPanel, patch: Partial<AIDefaults>): void {
  const model = panel.content.model;
  if (!model) return;
  const raw = (model.getMetadata(metadataKey) as Record<string, unknown> | undefined) || {};
  const defaults = { ...notebookDefaults(panel), ...patch };
  for (const key of ['backend', 'model', 'promptMode', 'reasoningEffort'] as (keyof AIDefaults)[]) {
    if (!defaults[key]) delete defaults[key];
  }
  model.setMetadata(metadataKey, { ...raw, defaults });
  decorate(panel);
}
function maybeSnapshotNotebookDefaults(panel: NotebookPanel): void {
  const model = panel.content.model;
  if (!model || panel.isDisposed) return;
  const raw = (model.getMetadata(metadataKey) as Record<string, unknown> | undefined) || {};
  if (raw.defaultsInitialized) { pendingSnapshots.delete(panel); return; }
  if (!serverStatus || !settings) { pendingSnapshots.add(panel); return; }
  const existing = notebookDefaults(panel);
  const effective = resolvedFor(panel);
  if (configured(serverStatus.providers, effective.backend) !== true) { pendingSnapshots.add(panel); return; }
  const modelId = existing.model || effective.model || serverStatus.providers?.[effective.backend]?.default_model || '';
  model.setMetadata(metadataKey, {
    ...raw,
    defaults: snapshotDefaults(existing, { ...effective, model: modelId }),
    defaultsInitialized: true
  });
  pendingSnapshots.delete(panel);
}
function flushPendingSnapshots(): void {
  for (const panel of Array.from(pendingSnapshots)) maybeSnapshotNotebookDefaults(panel);
}

function clearCellOverrides(cell: ICellModel): void {
  const value = { ...metadata(cell) };
  delete value.backend; delete value.model; delete value.promptMode; delete value.reasoningEffort;
  cell.setMetadata(metadataKey, value);
}
function resolvedFor(panel: NotebookPanel, cell?: ICellModel | null) {
  return resolveAI(cell ? metadata(cell) : {}, notebookDefaults(panel), {
    backend: preferredBackend(),
    models: { openai_api: modelFor('openai_api'), anthropic_api: modelFor('anthropic_api') },
    promptMode: currentPromptMode()
  }, serverStatus?.providers || null);
}

function onResponseSettingsChanged(): void {
  if (!modeSavePending) confirmedPromptMode = normalizePromptMode(settings?.get('promptMode').composite);
  if (!instructionsSavePending) confirmedInstructions = readInstructionOverrides(settings?.get('promptInstructions').composite);
  notebookTracker?.forEach(decorate);
}
function bindResponseSettings(value: ISettingRegistry.ISettings): void {
  settings?.changed.disconnect(onResponseSettingsChanged);
  settings = value;
  settingsError = null;
  settingsWarning = null;
  confirmedPromptMode = normalizePromptMode(value.get('promptMode').composite);
  confirmedInstructions = readInstructionOverrides(value.get('promptInstructions').composite);
  instructionNotices = {};
  settings.changed.connect(onResponseSettingsChanged);
  flushPendingSnapshots();
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
function protectedAnswer(panel: NotebookPanel, prompt: ICellModel): boolean {
  const output = findOutput(panel, prompt.id);
  return keepsCompletedAnswer(effectiveKeepAnswer(metadata(prompt).keepAnswer, notebookDefaults(panel).keepAnswers), output && {
    status: metadata(output).status,
    source: output.sharedModel.getSource()
  });
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
function status(panel: NotebookPanel, id: string, state: string, message: string, tooltip?: string): void {
  if (panel.isDisposed) return;
  const key = runKey(panel, id);
  const previous = statuses.get(key);
  statuses.set(key, { state, text: message,
    tooltip: tooltip ?? (state === 'running' && previous?.state === 'running' ? previous.tooltip : undefined) });
  const output = findOutput(panel, id);
  if (output && runs.get(key)?.output === output && ['running', 'done', 'error', 'cancelled'].includes(state)) setMetadata(output, { status: state });
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
    flushPendingSnapshots();
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
  flushPendingSnapshots();
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
  styleHeading.textContent = 'Default style for notebooks';
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
  styleDescription.textContent = 'Used when a notebook or cell has no style override. Learning guides with questions and up to three lines of code.';
  const styleNotice = document.createElement('div');
  styleNotice.className = 'nbinlineai-style-notice';
  styleNotice.setAttribute('role', 'status');
  styleNotice.textContent = 'Loading response style settings…';
  let refreshInstructionEditors: () => void = () => undefined;
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
      refreshInstructionEditors();
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
    refreshInstructionEditors();
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
        ? `${promptModeLabel(chosen)} is now your user default for notebooks without a style override.`
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
  const templateDetails = document.createElement('details');
  templateDetails.className = 'nbinlineai-template-details';
  templateDetails.dataset.nbinlineaiTemplateDetails = '';
  const templateHeading = document.createElement('summary');
  templateHeading.textContent = 'Edit style instructions';
  templateDetails.appendChild(templateHeading);
  const templateInfo = document.createElement('p');
  templateInfo.textContent = 'Edit the instructions behind each response style. Reset uses the current server default. Custom instructions apply to future runs and reruns.';
  templateDetails.appendChild(templateInfo);
  body.node.appendChild(templateDetails);
  const templateRows = new Map<PromptMode, { textarea: HTMLTextAreaElement; label: HTMLElement; save: HTMLButtonElement; reset: HTMLButtonElement }>();
  refreshInstructionEditors = () => {
    for (const [mode, row] of templateRows) {
      const custom = confirmedInstructions[mode];
      const serverDefault = serverStatus?.prompt_mode_instructions?.[mode] || '';
      if (document.activeElement !== row.textarea) row.textarea.value = custom || serverDefault;
      row.label.textContent = instructionNotices[mode] || (custom ? 'Custom instructions saved' : serverDefault ? 'Using server default' : 'Server default unavailable');
      row.reset.disabled = !settings || instructionsSavePending || !custom;
      row.save.disabled = !settings || instructionsSavePending;
    }
  };
  for (const mode of ['compact', 'full', 'learning'] as PromptMode[]) {
    const row = document.createElement('details');
    row.className = 'nbinlineai-template-row';
    row.dataset.nbinlineaiTemplateMode = mode;
    row.addEventListener('toggle', () => {
      if (row.open) for (const sibling of Array.from(templateDetails.querySelectorAll<HTMLDetailsElement>('.nbinlineai-template-row'))) if (sibling !== row) sibling.open = false;
    });
    const rowHeading = document.createElement('summary');
    rowHeading.textContent = promptModeLabel(mode);
    const name = document.createElement('label');
    name.textContent = `${promptModeLabel(mode)} instructions`;
    const textarea = document.createElement('textarea');
    textarea.dataset.nbinlineaiInstruction = mode;
    textarea.setAttribute('aria-label', `${promptModeLabel(mode)} instructions`);
    textarea.maxLength = 8000;
    textarea.rows = 4;
    name.appendChild(textarea);
    const state = document.createElement('span');
    state.className = 'nbinlineai-template-state';
    state.setAttribute('role', 'status');
    const save = document.createElement('button');
    save.type = 'button'; save.textContent = 'Save'; save.dataset.nbinlineaiInstructionSave = mode;
    const reset = document.createElement('button');
    reset.type = 'button'; reset.textContent = 'Reset'; reset.dataset.nbinlineaiInstructionReset = mode;
    templateRows.set(mode, { textarea, label: state, save, reset });
    const writeTemplate = async (custom: string | undefined) => {
      if (!settings) { state.textContent = 'Response style settings are unavailable. Nothing was saved.'; return; }
      if (instructionsSavePending) return;
      const next = { ...confirmedInstructions };
      if (custom) next[mode] = custom;
      else delete next[mode];
      save.disabled = true; reset.disabled = true;
      instructionsSavePending = true;
      refreshInstructionEditors();
      state.textContent = custom ? 'Saving custom instructions…' : 'Resetting to server default…';
      try {
        await settings.set('promptInstructions', next);
        const authoritative = readInstructionOverrides(settings.get('promptInstructions').composite);
        confirmedInstructions = authoritative;
        if ((authoritative[mode] || '') === (custom || '')) {
          settingsWarning = null;
          styleRetry.hidden = true;
          instructionNotices[mode] = custom ? 'Custom instructions saved for future runs.' : 'Using server default for future runs.';
        } else {
          settingsWarning = 'Could not confirm preset instructions.';
          styleRetry.hidden = false;
          instructionNotices[mode] = 'Saved instructions differ from the requested change. Choose Retry response style settings.';
        }
        refreshInstructionEditors();
      } catch {
        settingsWarning = 'Could not confirm preset instructions save.';
        styleRetry.hidden = false;
        instructionNotices[mode] = 'Could not confirm this change. Choose Retry response style settings to check what was saved.';
      } finally {
        instructionsSavePending = false;
        refreshInstructionEditors();
        tracker.forEach(decorate);
      }
    };
    save.addEventListener('click', () => {
      const custom = textarea.value.trim();
      if (!custom) { state.textContent = 'Enter nonblank instructions or choose Reset.'; return; }
      if (textarea.value.length > 8000) { state.textContent = 'Instructions must be 8000 characters or fewer.'; return; }
      void writeTemplate(textarea.value);
    });
    reset.addEventListener('click', () => { void writeTemplate(undefined); });
    row.append(rowHeading, name, state, save, reset);
    templateDetails.appendChild(row);
  }
  refreshInstructionEditors();
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
        refreshInstructionEditors();
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
async function executePrompt(panel: NotebookPanel, promptId: string): Promise<boolean> {
  if (runs.has(runKey(panel, promptId))) return false;
  const prompt = getCell(panel, promptId);
  const notebook = panel.content.model;
  if (!prompt || !isPrompt(prompt) || !notebook) return false;
  if (protectedAnswer(panel, prompt)) return true;
  statuses.delete(runKey(panel, promptId));
  const promptText = prompt.sharedModel.getSource().trim();
  if (!promptText) { status(panel, promptId, 'error', 'Write a prompt first.'); return false; }
  const sessionId = panel.sessionContext.session?.id;
  if (!sessionId) { status(panel, promptId, 'error', 'Start a kernel before running this prompt.'); return false; }
  const kernelId = panel.sessionContext.session?.kernel?.id;
  if (!kernelId) { status(panel, promptId, 'error', 'Start a kernel before running this prompt.'); return false; }
  await settingsReady;
  if (pendingCancels.delete(runKey(panel, promptId))) { status(panel, promptId, 'cancelled', 'Cancelled'); return false; }
  if (!settings) { status(panel, promptId, 'error', settingsError || 'Response style settings are unavailable. Open Configure AI and retry.'); return false; }
  if (!serverStatus || serverStatusError || serverStatus?.providers?.[resolvedFor(panel, prompt).backend]?.configured === false) {
    try { await fetchStatus(); }
    catch (error) { status(panel, promptId, 'error', error instanceof Error ? error.message : 'Could not reach the AI server.'); return false; }
  }
  if (pendingCancels.delete(runKey(panel, promptId))) { status(panel, promptId, 'cancelled', 'Cancelled'); return false; }
  maybeSnapshotNotebookDefaults(panel);
  const effective = resolvedFor(panel, prompt);
  const { backend, promptMode: mode } = effective;
  const available = configured(serverStatus?.providers || null, backend);
  if (available === false) { status(panel, promptId, 'error', 'API key required. Choose Configure AI or another provider.'); return false; }
  let preceding: ReturnType<typeof precedingCells>;
  try { preceding = precedingCells(notebook, promptId); }
  catch (error) { status(panel, promptId, 'error', error instanceof Error ? error.message : String(error)); return false; }
  let output: ICellModel;
  try { output = ensureOutput(panel, promptId); }
  catch (error) { status(panel, promptId, 'error', error instanceof Error ? error.message : 'Could not create an AI answer cell.'); return false; }
  output.sharedModel.setSource('');
  setMetadata(output, { status: 'running' });
  const controller = new AbortController();
  const run: RunState = { controller, panel, output, text: '', done: false, context: null, contextTrimmed: false };
  const bridge = new NotebookActionBridge(notebook, promptId, output.id);
  let serverRunId: string | null = null;
  runs.set(runKey(panel, promptId), run);
  status(panel, promptId, 'running', 'Preparing context…');
  const selectedModel = effective.model || undefined;
  const instructions = confirmedInstructions[mode];
  const modelId = effective.model || serverStatus?.providers?.[backend]?.default_model || '';
  const supportedEfforts = serverStatus?.model_capabilities?.[backend]?.[modelId]?.efforts || [];
  const effort = supportedEffort(effective.reasoningEffort, supportedEfforts);
  try {
    const response = await fetch(serverUrl('nbinlineai/prompt'), {
      method: 'POST', credentials: 'same-origin', headers: authHeaders(), signal: controller.signal,
      body: JSON.stringify({
        prompt: promptText, session_id: sessionId, prompt_cell_id: promptId,
        preceding_cells: preceding, backend, model: selectedModel, max_tool_steps: maxToolSteps(), prompt_mode: mode,
        ...(instructions ? { prompt_instructions: instructions } : {}),
        ...(effort ? { reasoning_effort: effort } : {})
      })
    });
    if (!response.ok) {
      const message = promptHttpErrorMessage(response.status);
      if (response.status === 404) throw new EndpointUnavailableError(message);
      throw new Error(message);
    }
    status(panel, promptId, 'running', 'Generating…');
    await readEventStream(response, async (event: StreamEvent) => {
      if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      if (event.type === 'text_delta') appendOutput(run, eventText(event));
      else if (event.type === 'context') {
        if (event.run_id !== undefined) {
          if (typeof event.run_id !== 'string' || !event.run_id || (serverRunId && serverRunId !== event.run_id)) {
            throw new Error('The AI server changed this notebook run ID.');
          }
          serverRunId = event.run_id;
        }
        const report = parseContextReport(event);
        if (report) {
          run.context = report;
          run.contextTrimmed ||= contextWasTrimmed(report);
          status(panel, promptId, 'running', runningContextText(report), contextTooltip(report, run.contextTrimmed));
        } else {
          const count = typeof event.cell_count === 'number' && Number.isSafeInteger(event.cell_count) && event.cell_count >= 0
            ? event.cell_count : preceding.length;
          status(panel, promptId, 'running', `Using ${count} preceding cells…`);
        }
      } else if (event.type === 'frontend_action') {
        if (!serverRunId || event.run_id !== serverRunId) throw new Error('The notebook action did not match this AI run.');
        if (typeof event.request_id !== 'string' || typeof event.name !== 'string') throw new Error('Invalid notebook action request.');
        if (panel.isDisposed || panel.content.model !== notebook || panel.sessionContext.session?.id !== sessionId ||
            panel.sessionContext.session?.kernel?.id !== kernelId ||
            getCell(panel, promptId) !== prompt || getCell(panel, output.id) !== output) {
          throw new Error('The originating notebook, prompt, answer, or kernel changed. Notebook action cancelled.');
        }
        const result = bridge.perform({ request_id: event.request_id, name: event.name, arguments: event.arguments });
        if (!result) return;
        status(panel, promptId, 'running', runningProgressText(`${event.name === 'insert_markdown' ? 'Adding a Markdown note' : 'Reading notebook cells'}…`, run.context));
        const reply = await fetch(serverUrl('nbinlineai/action-reply'), {
          method: 'POST', credentials: 'same-origin', headers: authHeaders(), signal: controller.signal,
          body: JSON.stringify({ run_id: serverRunId, request_id: event.request_id,
            session_id: sessionId, prompt_cell_id: promptId, ...result })
        });
        if (!reply.ok) throw new Error(`The notebook action reply was rejected (${reply.status}).`);
        const acknowledgement = await reply.json() as { accepted?: boolean };
        if (acknowledgement.accepted !== true) throw new Error('The notebook action reply was not acknowledged.');
        status(panel, promptId, 'running', runningProgressText(result.ok ? 'Notebook action completed; generating…' : `Notebook action failed: ${result.text}`, run.context));
      } else if (event.type === 'tool_start') status(panel, promptId, 'running', runningProgressText(`Running ${String(event.name || 'tool')}…`, run.context));
      else if (event.type === 'tool_result') status(panel, promptId, 'running', runningProgressText(`${String(event.name || 'Tool')} completed; generating…`, run.context));
      else if (event.type === 'error') throw new Error(String(event.message || 'AI request failed.'));
      else if (event.type === 'done') run.done = true;
    });
    if (!run.done) throw new Error('The response ended before completion.');
    refreshOutput(panel, output);
    status(panel, promptId, 'done', completedContextText(run.contextTrimmed),
      run.context ? contextTooltip(run.context, run.contextTrimmed) : undefined);
    return true;
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
    return false;
  } finally {
    runs.delete(runKey(panel, promptId));
    decorate(panel);
  }
}
function runPrompt(panel: NotebookPanel, promptId: string): Promise<boolean> {
  const key = runKey(panel, promptId);
  const existing = pendingPromptRuns.get(key);
  if (existing) return existing;
  const notebook = panel.content.model;
  const prompt = getCell(panel, promptId);
  if (!notebook || !prompt || !isPrompt(prompt) || panel.isDisposed) return Promise.resolve(false);
  let entered = false;
  const task = enqueueNotebookCell(notebook, async () => {
    entered = true;
    if (pendingCancels.delete(key) || panel.isDisposed) {
      status(panel, promptId, 'cancelled', 'Cancelled');
      return false;
    }
    return executePrompt(panel, promptId);
  });
  pendingPromptRuns.set(key, task);
  if (!protectedAnswer(panel, prompt)) status(panel, promptId, 'queued', 'Waiting to run…');
  else decorate(panel);
  void task.then(success => {
    if (pendingPromptRuns.get(key) === task) pendingPromptRuns.delete(key);
    pendingCancels.delete(key);
    if (!entered && !success) status(panel, promptId, 'cancelled', 'Skipped because an earlier cell failed or was cancelled.');
    else decorate(panel);
  }, () => {
    if (pendingPromptRuns.get(key) === task) pendingPromptRuns.delete(key);
    pendingCancels.delete(key);
    decorate(panel);
  });
  return task;
}
function cancelPrompt(panel: NotebookPanel, promptId: string): void {
  const key = runKey(panel, promptId);
  const running = runs.get(key);
  if (running) { running.controller.abort(); status(panel, promptId, 'cancelled', 'Cancelling…'); }
  else if (pendingPromptRuns.has(key)) { pendingCancels.add(key); status(panel, promptId, 'cancelled', 'Cancelled'); }
}
function insertPrompt(panel: NotebookPanel): void {
  const notebook = panel.content;
  NotebookActions.insertBelow(notebook);
  NotebookActions.changeCellType(notebook, 'markdown');
  const cell = notebook.activeCell;
  if (!cell) return;
  setMetadata(cell.model, { isPromptCell: true });
  cell.model.sharedModel.setSource('');
  maybeSnapshotNotebookDefaults(panel);
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

function syncEffortSelect(select: HTMLSelectElement, backend: Backend, model: string, saved: string, inherited?: string): void {
  const modelId = model || serverStatus?.providers?.[backend]?.default_model || '';
  const capabilities = serverStatus?.model_capabilities?.[backend]?.[modelId];
  const choices = capabilities?.efforts || [];
  const inheritedLabel = inherited === undefined ? '' : supportedEffort(inherited, choices) || 'Model default';
  const signature = JSON.stringify([backend, modelId, choices, capabilities?.default_effort, inheritedLabel]);
  if (select.dataset.optionsSignature !== signature) {
    select.replaceChildren();
    if (inherited !== undefined) {
      const inherit = document.createElement('option');
      inherit.value = '';
      inherit.textContent = `Notebook default (${inheritedLabel})`;
      select.appendChild(inherit);
    }
    const providerDefault = document.createElement('option');
    providerDefault.value = 'default';
    providerDefault.textContent = capabilities?.default_effort ? `Model default (${capabilities.default_effort})` : 'Model default';
    select.appendChild(providerDefault);
    for (const effort of choices) {
      const option = document.createElement('option');
      option.value = effort; option.textContent = effort;
      select.appendChild(option);
    }
    select.dataset.optionsSignature = signature;
  }
  select.value = choices.includes(saved) ? saved : saved ? 'default' : inherited === undefined ? 'default' : '';
  select.disabled = !serverStatus;
}

function syncNotebookDefaultsRow(panel: NotebookPanel): void {
  const row = panel.contentHeader.node.querySelector('[data-nbinlineai-notebook-defaults]') as HTMLElement | null;
  if (!row) return;
  const defaults = notebookDefaults(panel);
  const effective = resolvedFor(panel);
  const provider = row.querySelector('[data-nbinlineai-notebook-provider]') as HTMLSelectElement;
  const fallback = defaultProvider(preferredBackend(), serverStatus?.providers || null);
  provider.options[0].textContent = `Provider: User default (${fallback === 'openai_api' ? 'OpenAI' : 'Anthropic'})`;
  provider.value = defaults.backend || '';
  for (const option of Array.from(provider.options).slice(1)) {
    const backend = option.value as Backend;
    const usable = configured(serverStatus?.providers || null, backend);
    option.disabled = usable === false;
    option.textContent = `${backend === 'openai_api' ? 'OpenAI API' : 'Anthropic API'}${usable === false ? ' — API key required' : ''}`;
  }
  provider.disabled = !serverStatus;
  const model = row.querySelector('[data-nbinlineai-notebook-model-select]') as HTMLSelectElement;
  const custom = row.querySelector('[data-nbinlineai-notebook-model]') as HTMLInputElement;
  const models = availableModels(serverStatus?.providers?.[effective.backend]?.models);
  const defaultId = resolvedDefault(modelFor(effective.backend), serverStatus?.providers?.[effective.backend]?.default_model);
  const signature = JSON.stringify([effective.backend, defaultId, models]);
  if (model.dataset.optionsSignature !== signature) {
    model.replaceChildren();
    const base = document.createElement('option'); base.value = DEFAULT_MODEL; base.textContent = defaultId ? `Model: Default (${defaultId})` : 'Model: Default'; model.appendChild(base);
    for (const value of models) { const option = document.createElement('option'); option.value = value; option.textContent = value; model.appendChild(option); }
    const customOption = document.createElement('option'); customOption.value = CUSTOM_MODEL; customOption.textContent = 'Custom model…'; model.appendChild(customOption);
    model.dataset.optionsSignature = signature;
  }
  const choice = selectedModelChoice(defaults.model, models);
  if (!(model.dataset.customActive === 'true' && choice === DEFAULT_MODEL && model.value === CUSTOM_MODEL)) model.value = choice;
  custom.hidden = model.value !== CUSTOM_MODEL;
  if (document.activeElement !== custom) custom.value = model.value === CUSTOM_MODEL ? defaults.model || '' : '';
  model.disabled = !serverStatus || configured(serverStatus.providers, effective.backend) === false;
  custom.disabled = model.disabled;
  const style = row.querySelector('[data-nbinlineai-notebook-prompt-mode]') as HTMLSelectElement;
  style.options[0].textContent = `Style: User default (${promptModeLabel(currentPromptMode())})`;
  style.value = defaults.promptMode || '';
  style.disabled = !settings;
  const effort = row.querySelector('[data-nbinlineai-notebook-effort]') as HTMLSelectElement;
  syncEffortSelect(effort, effective.backend, effective.model, defaults.reasoningEffort || '');
  if (configured(serverStatus?.providers || null, effective.backend) === false) effort.disabled = true;
  const keep = row.querySelector('[data-nbinlineai-notebook-keep-answers]') as HTMLInputElement;
  keep.checked = defaults.keepAnswers !== false;
}

function createNotebookDefaultsRow(panel: NotebookPanel): Widget {
  const widget = new Widget();
  const row = widget.node;
  row.className = 'nbinlineai-notebook-defaults';
  row.dataset.nbinlineaiNotebookDefaults = '';
  const title = document.createElement('span'); title.textContent = 'AI defaults'; title.className = 'nbinlineai-defaults-title';
  const provider = document.createElement('select'); provider.dataset.nbinlineaiNotebookProvider = ''; provider.setAttribute('aria-label', 'Notebook AI provider default');
  for (const [value, label] of [['', 'Provider: User default'], ['openai_api', 'OpenAI API'], ['anthropic_api', 'Anthropic API']]) { const option = document.createElement('option'); option.value = value; option.textContent = label; provider.appendChild(option); }
  const model = document.createElement('select'); model.dataset.nbinlineaiNotebookModelSelect = ''; model.setAttribute('aria-label', 'Notebook AI model default');
  const custom = document.createElement('input'); custom.dataset.nbinlineaiNotebookModel = ''; custom.setAttribute('aria-label', 'Custom notebook AI model'); custom.placeholder = 'Model ID'; custom.hidden = true;
  const style = document.createElement('select'); style.dataset.nbinlineaiNotebookPromptMode = ''; style.setAttribute('aria-label', 'Notebook response style default');
  for (const [value, label] of [['', 'Style: User default'], ['compact', 'Compact'], ['full', 'Full'], ['learning', 'Learning']]) { const option = document.createElement('option'); option.value = value; option.textContent = label; style.appendChild(option); }
  const effort = document.createElement('select'); effort.dataset.nbinlineaiNotebookEffort = ''; effort.setAttribute('aria-label', 'Notebook reasoning effort default');
  const keepLabel = document.createElement('label'); keepLabel.className = 'nbinlineai-notebook-keep-answers';
  const keep = document.createElement('input'); keep.type = 'checkbox'; keep.dataset.nbinlineaiNotebookKeepAnswers = ''; keep.setAttribute('aria-label', 'Keep completed AI answers in this notebook');
  keepLabel.append(keep, document.createTextNode('Keep AI answers'));
  row.append(title, provider, model, custom, style, effort, keepLabel);
  provider.addEventListener('change', () => { setNotebookDefaults(panel, { backend: provider.value as Backend || undefined, model: undefined, reasoningEffort: undefined }); model.dataset.customActive = 'false'; });
  model.addEventListener('change', () => {
    if (model.value === CUSTOM_MODEL) { model.dataset.customActive = 'true'; custom.hidden = false; custom.focus(); }
    else { model.dataset.customActive = 'false'; setNotebookDefaults(panel, { model: model.value === DEFAULT_MODEL ? undefined : model.value, reasoningEffort: undefined }); }
  });
  custom.addEventListener('input', () => setNotebookDefaults(panel, { model: custom.value.trim() || undefined, reasoningEffort: undefined }));
  style.addEventListener('change', () => setNotebookDefaults(panel, { promptMode: style.value ? normalizePromptMode(style.value) : undefined }));
  effort.addEventListener('change', () => setNotebookDefaults(panel, { reasoningEffort: effort.value || undefined }));
  keep.addEventListener('change', () => setNotebookDefaults(panel, { keepAnswers: keep.checked }));
  syncNotebookDefaultsRow(panel);
  return widget;
}

function patchCellOverrides(cell: ICellModel, patch: Partial<CellMetadata>): void {
  const value = { ...metadata(cell), ...patch };
  for (const key of ['backend', 'model', 'promptMode', 'reasoningEffort'] as (keyof CellMetadata)[]) {
    if (!value[key]) delete value[key];
  }
  cell.setMetadata(metadataKey, value);
}
function makeControls(panel: NotebookPanel, id: string): HTMLElement {
  const controls = document.createElement('div');
  controls.className = 'nbinlineai-controls';
  controls.dataset.nbinlineaiPromptId = id;
  const run = document.createElement('button');
  run.dataset.nbinlineaiRun = '';
  run.textContent = 'Run AI';
  run.title = 'Run AI prompt (Shift+Enter)';
  run.addEventListener('click', () => { void runPrompt(panel, id); });
  const cancel = document.createElement('button');
  cancel.dataset.nbinlineaiCancel = '';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => cancelPrompt(panel, id));
  const toggle = document.createElement('button');
  toggle.dataset.nbinlineaiOverride = '';
  toggle.textContent = 'Override';
  toggle.setAttribute('aria-expanded', 'false');
  const keepLabel = document.createElement('label');
  keepLabel.className = 'nbinlineai-keep-answer';
  const keep = document.createElement('input');
  keep.type = 'checkbox';
  keep.dataset.nbinlineaiKeepAnswer = '';
  keep.setAttribute('aria-label', 'Keep answer');
  const keepText = document.createElement('span');
  keepText.textContent = 'Keep answer';
  keep.title = 'Protect a completed answer from reruns. Uncheck to replace it.';
  keepLabel.append(keep, keepText);
  const keepInherit = document.createElement('button');
  keepInherit.type = 'button';
  keepInherit.dataset.nbinlineaiKeepInherit = '';
  keepInherit.className = 'nbinlineai-keep-inherit';
  keepInherit.textContent = 'Use notebook setting';
  keepInherit.title = 'Remove this cell’s Keep answer override';
  keepInherit.addEventListener('click', () => {
    const cell = getCell(panel, id);
    if (!cell) return;
    const value = { ...metadata(cell) };
    delete value.keepAnswer;
    cell.setMetadata(metadataKey, value);
    decorate(panel);
  });
  keep.addEventListener('change', () => {
    const cell = getCell(panel, id);
    if (cell) setMetadata(cell, { keepAnswer: keep.checked });
    decorate(panel);
  });
  const summary = document.createElement('span');
  summary.className = 'nbinlineai-override-summary';
  summary.dataset.nbinlineaiOverrideSummary = '';
  const label = document.createElement('span');
  label.className = 'nbinlineai-status';
  label.setAttribute('role', 'status');
  const editor = document.createElement('div');
  editor.className = 'nbinlineai-override-editor';
  editor.dataset.nbinlineaiOverrideEditor = '';
  editor.hidden = true;
  toggle.addEventListener('click', () => { editor.hidden = !editor.hidden; toggle.setAttribute('aria-expanded', String(!editor.hidden)); });
  const provider = document.createElement('select');
  provider.dataset.nbinlineaiProvider = '';
  provider.setAttribute('aria-label', 'Cell AI provider override');
  for (const backend of backends) { const option = document.createElement('option'); option.value = backend; option.textContent = backend === 'openai_api' ? 'OpenAI API' : 'Anthropic API'; provider.appendChild(option); }
  const modelSelect = document.createElement('select');
  modelSelect.dataset.nbinlineaiModelSelect = '';
  modelSelect.setAttribute('aria-label', 'Cell AI model override');
  const modelInput = document.createElement('input');
  modelInput.dataset.nbinlineaiModel = '';
  modelInput.setAttribute('aria-label', 'Custom cell AI model ID');
  modelInput.placeholder = 'Model ID'; modelInput.hidden = true;
  const style = document.createElement('select');
  style.dataset.nbinlineaiPromptMode = '';
  style.setAttribute('aria-label', 'Cell response style override');
  for (const [value, text] of [['', 'Notebook default'], ['compact', 'Compact'], ['full', 'Full'], ['learning', 'Learning']]) { const option = document.createElement('option'); option.value = value; option.textContent = text; style.appendChild(option); }
  const effort = document.createElement('select');
  effort.dataset.nbinlineaiEffort = '';
  effort.setAttribute('aria-label', 'Cell reasoning effort override');
  const inherit = document.createElement('button');
  inherit.dataset.nbinlineaiInherit = '';
  inherit.textContent = 'Use notebook defaults';
  inherit.addEventListener('click', () => { const cell = getCell(panel, id); if (cell) clearCellOverrides(cell); editor.hidden = true; toggle.setAttribute('aria-expanded', 'false'); decorate(panel); });
  provider.addEventListener('change', () => {
    const cell = getCell(panel, id);
    if (cell) patchCellOverrides(cell, { backend: provider.value as Backend, model: undefined, reasoningEffort: undefined });
    modelSelect.dataset.customActive = 'false'; decorate(panel);
  });
  modelSelect.addEventListener('change', () => {
    const cell = getCell(panel, id); if (!cell) return;
    if (modelSelect.value === CUSTOM_MODEL) { modelSelect.dataset.customActive = 'true'; modelInput.hidden = false; modelInput.focus(); }
    else { modelSelect.dataset.customActive = 'false'; patchCellOverrides(cell, { backend: provider.value as Backend, model: modelSelect.value === DEFAULT_MODEL ? undefined : modelSelect.value, reasoningEffort: undefined }); decorate(panel); }
  });
  modelInput.addEventListener('input', () => { const cell = getCell(panel, id); if (cell) patchCellOverrides(cell, { backend: provider.value as Backend, model: modelInput.value.trim() || undefined, reasoningEffort: undefined }); decorate(panel); });
  style.addEventListener('change', () => { const cell = getCell(panel, id); if (cell) patchCellOverrides(cell, { promptMode: style.value ? normalizePromptMode(style.value) : undefined }); decorate(panel); });
  effort.addEventListener('change', () => { const cell = getCell(panel, id); if (cell) patchCellOverrides(cell, { reasoningEffort: effort.value || undefined }); decorate(panel); });
  editor.append(provider, modelSelect, modelInput, style, effort, inherit);
  controls.append(run, cancel, keepLabel, keepInherit, toggle, summary, label, editor);
  return controls;
}
function decorate(panel: NotebookPanel): void {
  if (panel.isDisposed) return;
  const prefix = `${panel.id}:`;
  for (const key of statuses.keys()) {
    if (!key.startsWith(prefix)) continue;
    const prompt = getCell(panel, key.slice(prefix.length));
    if (!isPrompt(prompt) || (statuses.get(key)?.state === 'done' && !findOutput(panel, prompt!.id))) statuses.delete(key);
  }
  syncNotebookDefaultsRow(panel);
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
    const effective = resolvedFor(panel, cell);
    const selectedProvider = controls.querySelector('[data-nbinlineai-provider]') as HTMLSelectElement;
    selectedProvider.value = effective.backend;
    const availableCount = backends.filter(backend => configured(serverStatus?.providers || null, backend)).length;
    for (const option of Array.from(selectedProvider.options)) {
      const backend = option.value as Backend;
      const usable = configured(serverStatus?.providers || null, backend);
      option.disabled = usable === false;
      option.textContent = `${backend === 'openai_api' ? 'OpenAI API' : 'Anthropic API'}${usable === false ? ' — API key required' : ''}`;
    }
    selectedProvider.disabled = !serverStatus || availableCount === 0;
    syncModelControls(controls, effective.backend, meta.model || '');
    const selectedAvailability = configured(serverStatus?.providers || null, effective.backend);
    const modelSelect = controls.querySelector('[data-nbinlineai-model-select]') as HTMLSelectElement;
    const notebookResolved = resolvedFor(panel);
    modelSelect.options[0].textContent = meta.backend && meta.backend !== notebookResolved.backend ? 'Provider default model' : `Notebook default model${notebookResolved.model ? ` (${notebookResolved.model})` : ''}`;
    const customInput = controls.querySelector('[data-nbinlineai-model]') as HTMLInputElement;
    modelSelect.disabled = selectedAvailability !== true;
    customInput.disabled = selectedAvailability !== true;
    const styleSelect = controls.querySelector('[data-nbinlineai-prompt-mode]') as HTMLSelectElement;
    styleSelect.options[0].textContent = `Notebook default (${promptModeLabel(resolvedFor(panel).promptMode)})`;
    styleSelect.value = meta.promptMode || '';
    styleSelect.disabled = !settings;
    const effortSelect = controls.querySelector('[data-nbinlineai-effort]') as HTMLSelectElement;
    syncEffortSelect(effortSelect, effective.backend, effective.model, meta.reasoningEffort || '', notebookResolved.reasoningEffort);
    if (selectedAvailability === false) effortSelect.disabled = true;
    effortSelect.title = effective.reasoningEffort && !supportedEffort(effective.reasoningEffort, serverStatus?.model_capabilities?.[effective.backend]?.[effective.model || serverStatus?.providers?.[effective.backend]?.default_model || '']?.efforts)
      ? 'This effort is not supported by the selected model; Model default will be used.' : 'Reasoning effort for this model';
    const summary = controls.querySelector('[data-nbinlineai-override-summary]') as HTMLElement;
    const parts = [meta.backend && (meta.backend === 'openai_api' ? 'OpenAI' : 'Anthropic'), meta.model, meta.promptMode && promptModeLabel(meta.promptMode), meta.reasoningEffort].filter(Boolean);
    summary.textContent = hasOverride(meta) ? `Override: ${parts.join(' · ')}` : '';
    const toggle = controls.querySelector('[data-nbinlineai-override]') as HTMLButtonElement;
    toggle.textContent = hasOverride(meta) ? 'Override (active)' : 'Override';
    const running = pendingPromptRuns.has(runKey(panel, cell.id));
    const runButton = controls.querySelector('[data-nbinlineai-run]') as HTMLButtonElement;
    const cancelButton = controls.querySelector('[data-nbinlineai-cancel]') as HTMLButtonElement;
    const keep = controls.querySelector('[data-nbinlineai-keep-answer]') as HTMLInputElement;
    keep.checked = effectiveKeepAnswer(meta.keepAnswer, notebookDefaults(panel).keepAnswers);
    keep.title = meta.keepAnswer === undefined ? 'Inherited from notebook. Change to override this cell.' : 'This cell overrides the notebook Keep answers setting.';
    const keepInherit = controls.querySelector('[data-nbinlineai-keep-inherit]') as HTMLButtonElement;
    keepInherit.hidden = meta.keepAnswer === undefined;
    const protectedCompleted = protectedAnswer(panel, cell);
    runButton.disabled = running || selectedAvailability === false || protectedCompleted;
    runButton.title = protectedCompleted ? 'Completed answer kept. Uncheck Keep answer to run again.' : 'Run AI prompt (Shift+Enter)';
    cancelButton.disabled = !running;
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
    label.title = serverStatusError || selectedAvailability === false ? '' : current?.tooltip || '';
    label.textContent = serverStatusError || (current?.state === 'running' ? current.text : '') || availabilityNotice ||
      (current?.state === 'done' && current.text.includes('context trimmed') ? current.text : '') ||
      (protectedCompleted ? 'Answer kept' : '') || current?.text || (serverStatus ? '' : 'Checking AI providers…');
  }
}
const executorPlugin: JupyterFrontEndPlugin<INotebookCellExecutor> = {
  id: 'nbinlineai:cell-executor',
  autoStart: true,
  provides: INotebookCellExecutor,
  activate: () => ({
    runCell: options => {
      if (isPrompt(options.cell.model)) {
        const panel = panelsByModel.get(options.notebook);
        if (!panel || panel.isDisposed) {
          options.onCellExecuted({ cell: options.cell, success: false });
          return Promise.resolve(false);
        }
        options.onCellExecutionScheduled({ cell: options.cell });
        const key = runKey(panel, options.cell.model.id);
        const pending = pendingPromptRuns.get(key);
        // A second native run joins the same request inside its own failure
        // boundary, so its later cells still stop if that request fails.
        const result = pending ? enqueueNotebookCell(options.notebook, () => pending) : runPrompt(panel, options.cell.model.id);
        return result.then(success => {
          options.onCellExecuted({ cell: options.cell, success });
          return success;
        });
      }
      return enqueueNotebookCell(options.notebook, () => runTrackedStandardCell(options, panelsByModel.get(options.notebook)));
    }
  })
};

const plugin: JupyterFrontEndPlugin<void> = {
  id: 'nbinlineai:plugin', autoStart: true, requires: [INotebookTracker, INotebookCellExecutor], optional: [ICommandPalette, ISettingRegistry],
  activate: (app: JupyterFrontEnd, tracker: INotebookTracker, _executor: INotebookCellExecutor, palette: ICommandPalette | null, registry: ISettingRegistry | null) => {
    notebookTracker = tracker;
    settingRegistry = registry;
    if (registry) settingsReady = registry.load(plugin.id).then(bindResponseSettings).catch(error => {
      settingsError = `Could not load response style settings: ${error instanceof Error ? error.message : String(error)}`;
      tracker.forEach(decorate);
    });
    else settingsError = 'JupyterLab response style settings are unavailable.';
    void fetchStatus().then(() => tracker.forEach(decorate)).catch(error => { console.warn('nbinlineai status unavailable:', error); tracker.forEach(decorate); });
    app.commands.addCommand(commandInsert, { label: 'Insert AI Prompt Cell', execute: () => { const panel = tracker.currentWidget; if (panel) insertPrompt(panel); } });
    app.commands.addCommand(commandRun, { label: 'Run AI Prompt Cell', isEnabled: () => {
      const panel = tracker.currentWidget;
      const cell = panel?.content.activeCell?.model;
      return !!panel && isPrompt(cell) && !protectedAnswer(panel, cell!);
    }, execute: () => {
      const panel = tracker.currentWidget; const id = panel?.content.activeCell?.model.id;
      if (panel && id) return runPrompt(panel, id);
    } });
    app.commands.addCommand(commandCancel, { label: 'Cancel AI Prompt Cell', isEnabled: () => !!tracker.currentWidget?.content.activeCell && pendingPromptRuns.has(runKey(tracker.currentWidget, tracker.currentWidget.content.activeCell.model.id)), execute: () => {
      const panel = tracker.currentWidget; const id = panel?.content.activeCell?.model.id;
      if (panel && id) cancelPrompt(panel, id);
    } });
    app.commands.addCommand(commandConfigure, { label: 'Configure AI Providers', execute: () => configureProviders(tracker) });
    for (const command of [commandInsert, commandRun, commandCancel, commandConfigure]) palette?.addItem({ command, category: 'AI' });
    const setup = (panel: NotebookPanel) => {
      const model = panel.content.model;
      if (model) panelsByModel.set(model, panel);
      void panel.context.ready.then(() => {
        if (panel.isDisposed) return;
        const configureButton = new ToolbarButton({ label: 'Configure AI', tooltip: 'Add or remove API keys', onClick: () => { void configureProviders(tracker); } });
        panel.toolbar.addItem('nbinlineai-configure', configureButton);
        const insertButton = new ToolbarButton({ icon: addIcon, label: 'AI Prompt', tooltip: 'Insert AI Prompt Cell', onClick: () => insertPrompt(panel) });
        if (!panel.toolbar.insertAfter('cellType', 'nbinlineai-insert', insertButton)) {
          panel.toolbar.addItem('nbinlineai-insert', insertButton);
        }
        panel.contentHeader.addWidget(createNotebookDefaultsRow(panel));
        decorate(panel);
        panel.content.model?.metadataChanged.connect(() => decorate(panel));
        panel.content.activeCellChanged.connect(() => decorate(panel));
        panel.content.model?.cells.changed.connect(() => { window.requestAnimationFrame(() => decorate(panel)); });
        const observer = new MutationObserver(records => {
          if (records.some(record => Array.from(record.addedNodes).some(node =>
            node instanceof Element && (node.matches('.jp-Cell, pre, pre > code') || !!node.querySelector('.jp-Cell, pre > code'))
          ))) decorate(panel);
        });
        observer.observe(panel.content.node, { childList: true, subtree: true });
        panel.disposed.connect(() => {
          observer.disconnect();
          if (model) panelsByModel.delete(model);
          pendingSnapshots.delete(panel);
          for (const key of pendingPromptRuns.keys()) if (key.startsWith(`${panel.id}:`)) pendingCancels.add(key);
          for (const [key, run] of runs) if (key.startsWith(`${panel.id}:`)) { run.controller.abort(); runs.delete(key); }
          for (const key of statuses.keys()) if (key.startsWith(`${panel.id}:`)) statuses.delete(key);
        });
      });
    };
    tracker.widgetAdded.connect((_, panel) => setup(panel));
    tracker.forEach(setup);
  }
};
export default [executorPlugin, plugin];
