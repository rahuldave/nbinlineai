import { JupyterFrontEnd, JupyterFrontEndPlugin } from '@jupyterlab/application';
import { ICommandPalette, ToolbarButton } from '@jupyterlab/apputils';
import { ICellModel, MarkdownCell } from '@jupyterlab/cells';
import { INotebookCellExecutor, INotebookModel, INotebookTracker, NotebookActions, NotebookPanel } from '@jupyterlab/notebook';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ServerConnection } from '@jupyterlab/services';
import { addIcon, copyIcon } from '@jupyterlab/ui-components';
import { Widget } from '@lumino/widgets';
import { notebookCells, snapshotTransportError } from './context';
import { NotebookContextControls, PreviewRequest, ensureCellControls, notebookContextMode } from './contextControls';
import { copyCodeText } from './codeCopy';
import { availableModels, CUSTOM_MODEL, DEFAULT_MODEL, resolvedDefault, selectedModelChoice, promptHttpErrorMessage, serverUnavailableMessage } from './modelChoice';
import { API_BACKENDS, ApiBackend, Backend, configured, defaultProvider, hasSelectableProvider, isBackend, KeyStatus, PROVIDERS, ServerStatus, SUBSCRIPTION_BACKEND, subscriptionConnectionErrorMessage, subscriptionSelectionIssue, unavailableMessage, visibleBackends } from './providerChoice';
import { EndpointUnavailableError, showConfigureProviders } from './configureAI';
import { SubscriptionSetupEnvironment } from './subscriptionSetup';
import { promptMode as normalizePromptMode, promptModeLabel, PromptMode } from './promptMode';
import { AIDefaults, hasOverride, resolveAI, snapshotDefaults, supportedEffort } from './defaults';
import { effectiveKeepAnswer, keepsCompletedAnswer } from './keepAnswer';
import { enqueueNotebookCell } from './executionQueue';
import { readEventStream, StreamEvent } from './sse';
import { NotebookActionBridge } from './frontendActions';
import { ContextReport, completedContextText, contextTooltip, contextWasTrimmed, parseContextReport, runningContextText, runningProgressText } from './contextStatus';
import { runTrackedStandardCell } from './insertTools';
import '../style/index.css';

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
interface RunState { controller: AbortController; panel: NotebookPanel; output: ICellModel; text: string; done: boolean; context: ContextReport | null; contextTrimmed: boolean }
const metadataKey = 'nbinlineai';
const commandInsert = 'nbinlineai:insert-prompt-cell';
const commandRun = 'nbinlineai:run-prompt-cell';
const commandCancel = 'nbinlineai:cancel-prompt-cell';
const commandConfigure = 'nbinlineai:configure-providers';
const runs = new Map<string, RunState>();
const pendingPromptRuns = new Map<string, Promise<boolean>>();
const pendingCancels = new Set<string>();
const panelsByModel = new WeakMap<INotebookModel, NotebookPanel>();
const statuses = new Map<string, { state: string; text: string; tooltip?: string }>();
const pendingSnapshots = new Set<NotebookPanel>();
const contextControls = new WeakMap<NotebookPanel, NotebookContextControls>();
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
let serverStatus: ServerStatus | null = null;
let serverStatusError: string | null = null;
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
function preferredBackend(): Backend {
  const selected = settings?.get('defaultBackend').composite;
  return isBackend(selected) ? selected : 'openai_api';
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
  for (const panel of Array.from(pendingSnapshots)) {
    // A status refresh after account sign-in must not initialize notebook
    // metadata. Keep the snapshot pending until explicit notebook use or run.
    if (resolvedFor(panel).backend !== SUBSCRIPTION_BACKEND) maybeSnapshotNotebookDefaults(panel);
  }
}

function clearCellOverrides(cell: ICellModel): void {
  const value = { ...metadata(cell) };
  delete value.backend; delete value.model; delete value.promptMode; delete value.reasoningEffort;
  cell.setMetadata(metadataKey, value);
}
function resolvedFor(panel: NotebookPanel, cell?: ICellModel | null) {
  return resolveAI(cell ? metadata(cell) : {}, notebookDefaults(panel), {
    backend: preferredBackend(),
    models: { openai_api: modelFor('openai_api'), anthropic_api: modelFor('anthropic_api'), openai_codex_subscription: modelFor('openai_codex_subscription') },
    promptMode: currentPromptMode()
  }, serverStatus?.providers || null);
}

function onResponseSettingsChanged(): void {
  if (!modeSavePending) confirmedPromptMode = normalizePromptMode(settings?.get('promptMode').composite);
  if (!instructionsSavePending) confirmedInstructions = readInstructionOverrides(settings?.get('promptInstructions').composite);
  notebookTracker?.forEach(panel => { contextControls.get(panel)?.invalidate(); decorate(panel); });
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
  notebookTracker?.forEach(panel => { contextControls.get(panel)?.invalidate(); decorate(panel); });
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
    serverStatus = await response.json() as ServerStatus;
    serverStatusError = null;
    flushPendingSnapshots();
  } catch (error) {
    serverStatusError = error instanceof Error ? error.message : 'Could not reach the AI server.';
    throw error;
  }
}

async function fetchContextPreview(panel: NotebookPanel, body: PreviewRequest, signal: AbortSignal): Promise<unknown> {
  await settingsReady;
  const prompt = getCell(panel, body.prompt_cell_id);
  if (!prompt) throw new Error('The selected AI question was removed.');
  const effective = resolvedFor(panel, prompt);
  const instructions = confirmedInstructions[effective.promptMode];
  const response = await fetch(serverUrl('nbinlineai/context-preview'), {
    method: 'POST', credentials: 'same-origin', headers: authHeaders(), signal,
    body: JSON.stringify({ ...body, backend: effective.backend, model: effective.model || undefined,
      prompt_mode: effective.promptMode, ...(instructions ? { prompt_instructions: instructions } : {}) })
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({})) as { message?: string; error?: string };
    throw new Error(result.message || result.error || (response.status === 409 ? 'Kernel is busy. Refresh when it is idle.' :
      response.status === 404 ? 'Context preview is unavailable. Restart the Jupyter server after updating.' : `Context preview failed (${response.status}).`));
  }
  return response.json();
}

async function fetchKeyStatus(): Promise<KeyStatus> {
  const response = await fetch(serverUrl('nbinlineai/settings/keys'), { credentials: 'same-origin', headers: authHeaders() });
  if (response.status === 404) throw new EndpointUnavailableError(serverUnavailableMessage('settings'));
  if (!response.ok) throw new Error(`Could not load provider settings (${response.status}).`);
  return response.json() as Promise<KeyStatus>;
}

async function changeKey(backend: ApiBackend, method: 'POST' | 'DELETE', key?: string): Promise<KeyStatus> {
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

async function subscriptionRequest<T>(path: string, method: 'GET' | 'POST' = 'GET', body?: object): Promise<T> {
  const response = await fetch(serverUrl(`nbinlineai/${path}`), {
    method, credentials: 'same-origin', headers: authHeaders(),
    ...(method === 'POST' ? { body: JSON.stringify(body || {}) } : {})
  });
  if (!response.ok) {
    let message = `ChatGPT connection request failed (${response.status}).`;
    try {
      const result = await response.json() as { message?: string };
      if (typeof result.message === 'string' && result.message.length <= 500) message = result.message;
    } catch { /* Keep the safe status message. */ }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

function mergeKeyStatus(result: KeyStatus): void {
  if (!serverStatus) return;
  for (const backend of API_BACKENDS) {
    const key = result.providers?.[backend];
    const provider = serverStatus.providers?.[backend];
    if (key && provider) serverStatus.providers[backend] = { ...provider, configured: key.configured, source: key.source };
  }
  flushPendingSnapshots();
}

function configureProviders(tracker: INotebookTracker): Promise<void> {
  if (configureDialog) return configureDialog;
  const origin = tracker.currentWidget;
  const originModel = origin?.content.model;
  const boundPanel = () => origin && !origin.isDisposed && origin.content.model === originModel ? origin : null;
  const subscription: SubscriptionSetupEnvironment = {
    capable: () => serverStatus?.subscription_capable === true,
    sessionId: () => boundPanel()?.sessionContext.session?.id || null,
    notebookChoice: () => {
      const panel = boundPanel();
      return panel ? notebookDefaults(panel) : {};
    },
    useForNotebook: (model, effort) => {
      const panel = boundPanel();
      if (!panel || !panel.sessionContext.session?.id) throw new Error('The originating notebook session changed. Reopen Configure AI.');
      if (serverStatus?.subscription_capable !== true || serverStatus.providers?.openai_codex_subscription?.configured !== true ||
          !serverStatus.providers.openai_codex_subscription.models.includes(model)) {
        throw new Error('The selected ChatGPT connection or model is unavailable. Check connection again.');
      }
      setNotebookDefaults(panel, { backend: 'openai_codex_subscription', model, reasoningEffort: effort || 'default' });
    },
    request: subscriptionRequest,
    refreshProviders: async () => { await fetchStatus(); tracker.forEach(decorate); }
  };
  configureDialog = showConfigureProviders(tracker, {
    state: {
      get settings() { return settings; },
      get settingsError() { return settingsError; },
      get settingsWarning() { return settingsWarning; }, set settingsWarning(value) { settingsWarning = value; },
      get settingRegistry() { return settingRegistry; },
      get modeSavePending() { return modeSavePending; }, set modeSavePending(value) { modeSavePending = value; },
      get instructionsSavePending() { return instructionsSavePending; }, set instructionsSavePending(value) { instructionsSavePending = value; },
      get confirmedPromptMode() { return confirmedPromptMode; }, set confirmedPromptMode(value) { confirmedPromptMode = value; },
      get confirmedInstructions() { return confirmedInstructions; }, set confirmedInstructions(value) { confirmedInstructions = value; },
      get instructionNotices() { return instructionNotices; }, set instructionNotices(value) { instructionNotices = value; }
    },
    settingsReady, currentPromptMode, reloadResponseSettings, readInstructionOverrides,
    fetchKeyStatus, changeKey, mergeKeyStatus, fetchStatus, getServerStatus: () => serverStatus, decorate,
    subscription
  }).finally(() => { configureDialog = null; });
  return configureDialog;
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
  let effective = resolvedFor(panel, prompt);
  const { backend } = effective;
  const available = configured(serverStatus?.providers || null, backend);
  if (available === false) {
    const anyApiConfigured = API_BACKENDS.some(candidate => configured(serverStatus?.providers || null, candidate));
    status(panel, promptId, 'error', unavailableMessage(backend, anyApiConfigured));
    return false;
  }
  const selectionIssue = backend === SUBSCRIPTION_BACKEND
    ? subscriptionSelectionIssue(serverStatus, effective.model, effective.reasoningEffort) : null;
  if (selectionIssue) { status(panel, promptId, 'error', selectionIssue); return false; }
  maybeSnapshotNotebookDefaults(panel);
  effective = resolvedFor(panel, prompt);
  const { promptMode: mode } = effective;
  let cells: ReturnType<typeof notebookCells>;
  try { cells = notebookCells(notebook, promptId); }
  catch (error) { status(panel, promptId, 'error', error instanceof Error ? error.message : String(error)); return false; }
  const snapshotError = snapshotTransportError(cells);
  if (snapshotError) { status(panel, promptId, 'error', snapshotError); return false; }
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
        snapshot_version: 1, notebook_cells: cells, context_mode: notebookContextMode(panel),
        backend, model: selectedModel, max_tool_steps: maxToolSteps(), prompt_mode: mode,
        ...(instructions ? { prompt_instructions: instructions } : {}),
        ...(effort ? { reasoning_effort: effort } : {})
      })
    });
    if (!response.ok) {
      let message = promptHttpErrorMessage(response.status);
      if (backend === SUBSCRIPTION_BACKEND && response.status === 400) {
        try {
          await fetchStatus();
          notebookTracker?.forEach(decorate);
          message = subscriptionConnectionErrorMessage(serverStatus) ||
            subscriptionSelectionIssue(serverStatus, effective.model, effective.reasoningEffort) || message;
        } catch {
          // The generic message remains safe if the status endpoint is unavailable.
        }
      }
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
            ? event.cell_count : cells.length;
          status(panel, promptId, 'running', `Using ${count} notebook cells…`);
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
  contextControls.get(panel)?.onActiveCellChanged(true);
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

function syncProviderSelect(select: HTMLSelectElement, selected: string, preserve?: Backend): void {
  const visible = visibleBackends(serverStatus?.providers || null, preserve);
  for (const option of Array.from(select.options)) {
    if (option.value === SUBSCRIPTION_BACKEND && !visible.includes(SUBSCRIPTION_BACKEND)) option.remove();
  }
  for (const backend of visible) {
    let option = Array.from(select.options).find(candidate => candidate.value === backend);
    if (!option) {
      option = document.createElement('option');
      option.value = backend;
      select.appendChild(option);
    }
    const unavailable = configured(serverStatus?.providers || null, backend) === false;
    option.disabled = unavailable;
    option.textContent = `${PROVIDERS[backend].label}${unavailable ? ` — ${PROVIDERS[backend].unavailable}` : ''}`;
  }
  select.value = selected;
}

function syncNotebookDefaultsRow(panel: NotebookPanel): void {
  const row = panel.contentHeader.node.querySelector('[data-nbinlineai-notebook-defaults]') as HTMLElement | null;
  if (!row) return;
  const defaults = notebookDefaults(panel);
  const effective = resolvedFor(panel);
  const provider = row.querySelector('[data-nbinlineai-notebook-provider]') as HTMLSelectElement;
  const fallback = defaultProvider(preferredBackend(), serverStatus?.providers || null);
  provider.options[0].textContent = `Provider: User default (${PROVIDERS[fallback].shortLabel})`;
  syncProviderSelect(provider, defaults.backend || '', defaults.backend || fallback);
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
  model.disabled = !serverStatus || (configured(serverStatus.providers, effective.backend) === false && effective.backend !== SUBSCRIPTION_BACKEND);
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
  contextControls.get(panel)?.syncHeader();
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
  provider.addEventListener('change', () => {
    if (provider.value && !isBackend(provider.value)) return;
    setNotebookDefaults(panel, { backend: provider.value as Backend || undefined, model: undefined, reasoningEffort: undefined });
    model.dataset.customActive = 'false';
  });
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

function createNotebookContextRow(panel: NotebookPanel): { widget: Widget; observer: ResizeObserver } {
  const widget = new Widget();
  widget.node.style.minHeight = '32px';
  const row = document.createElement('div');
  row.className = 'nbinlineai-context-row';
  const context = contextControls.get(panel)!;
  const title = document.createElement('span'); title.textContent = 'Context'; title.className = 'nbinlineai-context-title';
  row.append(title, context.modeSelect, context.details);
  widget.node.append(row);
  const observer = new ResizeObserver(() => {
    if (widget.isDisposed || panel.isDisposed) return;
    const height = Math.ceil(row.getBoundingClientRect().height);
    if (height > 0 && widget.node.style.minHeight !== `${height}px`) {
      widget.node.style.minHeight = `${height}px`;
      panel.contentHeader.fit();
    }
  });
  observer.observe(row);
  return { widget, observer };
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
  // Keep a button click on this cell's toolbar intact when a different
  // Markdown cell is in edit mode. JupyterLab switches cells on mousedown;
  // rendering that earlier cell can move this button before mouseup.
  // JupyterLab skips notebook mousedown handling for prevented toolbar clicks.
  controls.addEventListener('mousedown', event => {
    if (event.button === 0 && event.target instanceof Element && event.target.closest('button')) event.preventDefault();
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
  const starters = document.createElement('div');
  starters.className = 'nbinlineai-starters';
  starters.dataset.nbinlineaiStarters = '';
  const starterChoices = [
    ['explain-cell', 'Explain cell above', 'Explain the cell immediately above this question. Use earlier context where helpful.'],
    ['explain-code', 'Explain code above', 'Explain the nearest code cell above this question. Use earlier context where helpful.'],
    ['explain-section', 'Explain section above', 'Explain the section above this question. Use earlier context where helpful.'],
    ['write-code', 'Write code…', 'Write code to ']
  ] as const;
  for (const [name, text, source] of starterChoices) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.nbinlineaiStarter = name;
    button.textContent = text;
    button.title = 'Insert editable text into this AI question';
    button.addEventListener('click', () => {
      const cell = getCell(panel, id);
      if (!cell || !isPrompt(cell) || cell.sharedModel.getSource().trim()) return;
      const notebook = panel.content;
      const index = notebook.widgets.findIndex(widget => widget.model.id === id);
      if (index < 0) return;
      notebook.activeCellIndex = index;
      notebook.mode = 'edit';
      cell.sharedModel.setSource(source);
      const editor = notebook.activeCell?.editor;
      editor?.setCursorPosition({ line: 0, column: source.length });
      editor?.focus();
    });
    starters.append(button);
  }
  const editor = document.createElement('div');
  editor.className = 'nbinlineai-override-editor';
  editor.dataset.nbinlineaiOverrideEditor = '';
  editor.hidden = true;
  toggle.addEventListener('click', () => { editor.hidden = !editor.hidden; toggle.setAttribute('aria-expanded', String(!editor.hidden)); });
  const provider = document.createElement('select');
  provider.dataset.nbinlineaiProvider = '';
  provider.setAttribute('aria-label', 'Cell AI provider override');
  for (const backend of API_BACKENDS) { const option = document.createElement('option'); option.value = backend; option.textContent = backend === 'openai_api' ? 'OpenAI API' : 'Anthropic API'; provider.appendChild(option); }
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
    if (cell && isBackend(provider.value)) patchCellOverrides(cell, { backend: provider.value, model: undefined, reasoningEffort: undefined });
    modelSelect.dataset.customActive = 'false'; decorate(panel);
  });
  modelSelect.addEventListener('change', () => {
    const cell = getCell(panel, id); if (!cell) return;
    if (modelSelect.value === CUSTOM_MODEL) { modelSelect.dataset.customActive = 'true'; modelInput.hidden = false; modelInput.focus(); }
    else {
      modelSelect.dataset.customActive = 'false';
      const backend = isBackend(provider.value) ? provider.value : resolvedFor(panel, cell).backend;
      patchCellOverrides(cell, { backend, model: modelSelect.value === DEFAULT_MODEL ? undefined : modelSelect.value, reasoningEffort: undefined });
      decorate(panel);
    }
  });
  modelInput.addEventListener('input', () => {
    const cell = getCell(panel, id);
    if (cell) {
      const backend = isBackend(provider.value) ? provider.value : resolvedFor(panel, cell).backend;
      patchCellOverrides(cell, { backend, model: modelInput.value.trim() || undefined, reasoningEffort: undefined });
    }
    decorate(panel);
  });
  style.addEventListener('change', () => { const cell = getCell(panel, id); if (cell) patchCellOverrides(cell, { promptMode: style.value ? normalizePromptMode(style.value) : undefined }); decorate(panel); });
  effort.addEventListener('change', () => { const cell = getCell(panel, id); if (cell) patchCellOverrides(cell, { reasoningEffort: effort.value || undefined }); decorate(panel); });
  editor.append(provider, modelSelect, modelInput, style, effort, inherit);
  controls.append(run, cancel, keepLabel, keepInherit, toggle, summary, label, starters, editor);
  return controls;
}
function decorate(panel: NotebookPanel): void {
  if (panel.isDisposed) return;
  contextControls.get(panel)?.prepareDecoration();
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
    contextControls.get(panel)?.decorateCell(cell, widget.node);
    widget.toggleClass('nbinlineai-prompt-cell', !!meta.isPromptCell);
    widget.toggleClass('nbinlineai-output-cell', !!meta.isOutputCell);
    widget.toggleClass('nbinlineai-response-cell', !!meta.isOutputCell);
    if (meta.isOutputCell && widget instanceof MarkdownCell) {
      if (!widget.rendered && !(panel.content.activeCell === widget && panel.content.mode === 'edit')) widget.rendered = true;
      decorateCodeCopy(widget);
    }
    const cellControls = ensureCellControls(widget.node);
    if (!meta.isPromptCell) { cellControls.querySelector(':scope > .nbinlineai-controls')?.remove(); continue; }
    let controls = (cellControls.querySelector(':scope > .nbinlineai-controls') ||
      widget.node.querySelector(':scope > .nbinlineai-controls')) as HTMLElement | null;
    if (!controls) controls = makeControls(panel, cell.id);
    if (controls.parentElement !== cellControls) cellControls.appendChild(controls);
    const effective = resolvedFor(panel, cell);
    const selectedProvider = controls.querySelector('[data-nbinlineai-provider]') as HTMLSelectElement;
    syncProviderSelect(selectedProvider, effective.backend, effective.backend);
    const anyApiConfigured = API_BACKENDS.some(backend => configured(serverStatus?.providers || null, backend) === true);
    selectedProvider.disabled = !serverStatus || !hasSelectableProvider(serverStatus.providers, serverStatus.subscription_capable === true);
    syncModelControls(controls, effective.backend, meta.model || '');
    const selectedAvailability = configured(serverStatus?.providers || null, effective.backend);
    const subscriptionIssue = effective.backend === SUBSCRIPTION_BACKEND && selectedAvailability === true
      ? subscriptionSelectionIssue(serverStatus, effective.model, effective.reasoningEffort) : null;
    const modelSelect = controls.querySelector('[data-nbinlineai-model-select]') as HTMLSelectElement;
    const notebookResolved = resolvedFor(panel);
    modelSelect.options[0].textContent = meta.backend && meta.backend !== notebookResolved.backend ? 'Provider default model' : `Notebook default model${notebookResolved.model ? ` (${notebookResolved.model})` : ''}`;
    const customInput = controls.querySelector('[data-nbinlineai-model]') as HTMLInputElement;
    const modelEditable = selectedAvailability === true || (serverStatus && effective.backend === SUBSCRIPTION_BACKEND);
    modelSelect.disabled = !modelEditable;
    customInput.disabled = !modelEditable;
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
    const parts = [meta.backend && (PROVIDERS[meta.backend]?.shortLabel || meta.backend), meta.model,
      meta.promptMode && promptModeLabel(meta.promptMode), meta.reasoningEffort].filter(Boolean);
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
    runButton.disabled = running || selectedAvailability === false || !!subscriptionIssue || protectedCompleted;
    runButton.title = protectedCompleted ? 'Completed answer kept. Uncheck Keep answer to run again.' : 'Run AI prompt (Shift+Enter)';
    cancelButton.disabled = !running;
    const label = controls.querySelector('.nbinlineai-status') as HTMLElement;
    const starters = controls.querySelector('[data-nbinlineai-starters]') as HTMLElement;
    starters.hidden = !!cell.sharedModel.getSource().trim();
    const key = runKey(panel, cell.id);
    let current = statuses.get(key);
    if (selectedAvailability === true && current?.state === 'error' &&
        (current.text.startsWith('API key required.') || current.text.startsWith('ChatGPT subscription unavailable.') ||
         current.text.startsWith('Selected ChatGPT '))) {
      statuses.delete(key);
      current = undefined;
    }
    const availabilityNotice = selectedAvailability === false
      ? unavailableMessage(effective.backend, anyApiConfigured) : subscriptionIssue || '';
    label.dataset.state = serverStatusError || availabilityNotice ? 'error' : current?.state || 'idle';
    label.title = serverStatusError || availabilityNotice ? '' : current?.tooltip || '';
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
      let boundModel = panel.content.model;
      if (boundModel) panelsByModel.set(boundModel, panel);
      void panel.context.ready.then(() => {
        if (panel.isDisposed) return;
        const context = new NotebookContextControls(panel, (body, signal) => fetchContextPreview(panel, body, signal), () => decorate(panel), targetId => {
          const effective = resolvedFor(panel, targetId ? getCell(panel, targetId) : undefined);
          return [effective, confirmedInstructions[effective.promptMode], settings?.get('maxToolSteps').composite];
        });
        contextControls.set(panel, context);
        const configureButton = new ToolbarButton({ label: 'Configure AI', tooltip: 'Set up ChatGPT or API keys', onClick: () => { void configureProviders(tracker); } });
        panel.toolbar.addItem('nbinlineai-configure', configureButton);
        const insertButton = new ToolbarButton({ icon: addIcon, label: 'AI Prompt', tooltip: 'Insert AI Prompt Cell', onClick: () => insertPrompt(panel) });
        if (!panel.toolbar.insertAfter('cellType', 'nbinlineai-insert', insertButton)) {
          panel.toolbar.addItem('nbinlineai-insert', insertButton);
        }
        panel.contentHeader.addWidget(createNotebookDefaultsRow(panel));
        const contextRow = createNotebookContextRow(panel);
        panel.contentHeader.addWidget(contextRow.widget);
        panel.contentHeader.fit();
        decorate(panel);
        let notebookWidth = panel.content.node.getBoundingClientRect().width;
        const cellWidthObserver = new ResizeObserver(entries => {
          const width = entries[0]?.contentRect.width || 0;
          if (!width || Math.abs(width - notebookWidth) < 1) return;
          notebookWidth = width;
          window.requestAnimationFrame(() => { if (!panel.isDisposed) decorate(panel); });
        });
        cellWidthObserver.observe(panel.content.node);
        const onMetadataChanged = () => decorate(panel);
        const onCellsChanged = () => { context.invalidate(); window.requestAnimationFrame(() => decorate(panel)); };
        const onContentChanged = () => { context.invalidate(); };
        const bindModel = () => {
          const next = panel.content.model;
          if (boundModel === next) return;
          if (boundModel) {
            boundModel.metadataChanged.disconnect(onMetadataChanged);
            boundModel.cells.changed.disconnect(onCellsChanged);
            boundModel.contentChanged.disconnect(onContentChanged);
            panelsByModel.delete(boundModel);
          }
          boundModel = next;
          if (next) {
            panelsByModel.set(next, panel);
            next.metadataChanged.connect(onMetadataChanged);
            next.cells.changed.connect(onCellsChanged);
            next.contentChanged.connect(onContentChanged);
          }
          context.onModelChanged();
        };
        if (boundModel) {
          boundModel.metadataChanged.connect(onMetadataChanged);
          boundModel.cells.changed.connect(onCellsChanged);
          boundModel.contentChanged.connect(onContentChanged);
        }
        panel.content.modelChanged.connect(bindModel);
        bindModel();
        panel.content.activeCellChanged.connect(() => { context.onActiveCellChanged(); decorate(panel); });
        panel.sessionContext.kernelChanged.connect(() => { context.invalidate(); });
        panel.sessionContext.statusChanged.connect((_, state) => context.onKernelStatus(state));
        context.onActiveCellChanged();
        const observer = new MutationObserver(records => {
          if (records.some(record => Array.from(record.addedNodes).some(node =>
            node instanceof Element && (node.matches('.jp-Cell, pre, pre > code') || !!node.querySelector('.jp-Cell, pre > code'))
          ))) decorate(panel);
        });
        observer.observe(panel.content.node, { childList: true, subtree: true });
        panel.disposed.connect(() => {
          context.dispose();
          contextRow.observer.disconnect();
          cellWidthObserver.disconnect();
          observer.disconnect();
          panel.content.modelChanged.disconnect(bindModel);
          if (boundModel) {
            boundModel.metadataChanged.disconnect(onMetadataChanged);
            boundModel.cells.changed.disconnect(onCellsChanged);
            boundModel.contentChanged.disconnect(onContentChanged);
            panelsByModel.delete(boundModel);
          }
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
