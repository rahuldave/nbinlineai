import { Dialog, showDialog } from '@jupyterlab/apputils';
import { INotebookTracker } from '@jupyterlab/notebook';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { Widget } from '@lumino/widgets';
import { API_BACKENDS, ApiBackend, isBackend, KeyStatus, PROVIDERS, ServerStatus, SUBSCRIPTION_BACKEND } from './providerChoice';
import { promptMode as normalizePromptMode, promptModeLabel, PromptMode } from './promptMode';
import { SubscriptionSetup, SubscriptionSetupEnvironment } from './subscriptionSetup';

export class EndpointUnavailableError extends Error {}

export interface ConfigureAIState {
  settings: ISettingRegistry.ISettings | null;
  settingsError: string | null;
  settingsWarning: string | null;
  settingRegistry: ISettingRegistry | null;
  modeSavePending: boolean;
  instructionsSavePending: boolean;
  confirmedPromptMode: PromptMode;
  confirmedInstructions: Partial<Record<PromptMode, string>>;
  instructionNotices: Partial<Record<PromptMode, string>>;
}

export interface ConfigureAIEnvironment {
  state: ConfigureAIState;
  settingsReady: Promise<void>;
  currentPromptMode: () => PromptMode;
  reloadResponseSettings: () => Promise<void>;
  readInstructionOverrides: (value: unknown) => Partial<Record<PromptMode, string>>;
  fetchKeyStatus: () => Promise<KeyStatus>;
  changeKey: (backend: ApiBackend, method: 'POST' | 'DELETE', key?: string) => Promise<KeyStatus>;
  mergeKeyStatus: (result: KeyStatus) => void;
  fetchStatus: () => Promise<void>;
  getServerStatus: () => ServerStatus | null;
  decorate: (panel: import('@jupyterlab/notebook').NotebookPanel) => void;
  subscription: SubscriptionSetupEnvironment;
}

export async function showConfigureProviders(tracker: INotebookTracker, env: ConfigureAIEnvironment): Promise<void> {
  const { state, settingsReady, currentPromptMode, reloadResponseSettings, readInstructionOverrides,
    fetchKeyStatus, changeKey, mergeKeyStatus, fetchStatus, decorate } = env;
  let settings = state.settings;
  const body = new Widget();
  body.node.className = 'nbinlineai-keys-dialog';
  body.node.dataset.nbinlineaiKeysDialog = '';
  const connectionLabel = document.createElement('label');
  connectionLabel.className = 'nbinlineai-connection-selector';
  connectionLabel.textContent = 'Connection';
  const connectionSelect = document.createElement('select');
  connectionSelect.dataset.nbinlineaiConnection = '';
  for (const backend of [SUBSCRIPTION_BACKEND, ...API_BACKENDS]) {
    const option = document.createElement('option');
    option.value = backend; option.textContent = PROVIDERS[backend].label; connectionSelect.appendChild(option);
  }
  const initial = env.subscription.notebookChoice().backend;
  connectionSelect.value = isBackend(initial) ? initial : 'openai_api';
  connectionLabel.appendChild(connectionSelect);
  const subscriptionSetup = new SubscriptionSetup(env.subscription);
  body.node.append(connectionLabel, subscriptionSetup.node);
  const defaultHeading = document.createElement('h3');
  defaultHeading.textContent = 'Default connection for new notebooks';
  const defaultSelect = document.createElement('select');
  defaultSelect.dataset.nbinlineaiDefaultBackend = '';
  defaultSelect.setAttribute('aria-label', 'Default AI connection for new notebooks');
  defaultSelect.disabled = true;
  for (const backend of [SUBSCRIPTION_BACKEND, ...API_BACKENDS]) {
    const option = document.createElement('option');
    option.value = backend; option.textContent = PROVIDERS[backend].label; defaultSelect.appendChild(option);
  }
  const defaultDescription = document.createElement('p');
  defaultDescription.textContent = 'Used by new notebooks. Existing notebook defaults and cell overrides stay as saved; change them in the notebook when needed.';
  const defaultNotice = document.createElement('div');
  defaultNotice.setAttribute('role', 'status');
  defaultNotice.dataset.nbinlineaiDefaultBackendNotice = '';
  body.node.append(defaultHeading, defaultSelect, defaultDescription, defaultNotice);
  const syncDefaultBackend = () => {
    const saved = settings?.get('defaultBackend').composite;
    defaultSelect.value = isBackend(saved) ? saved : 'openai_api';
    defaultSelect.disabled = !settings;
  };
  let keyArea: HTMLElement | null = null;
  const syncConnectionDetails = () => {
    const capable = env.getServerStatus()?.subscription_capable === true && env.subscription.capable();
    connectionLabel.hidden = !capable;
    subscriptionSetup.setVisible(capable && connectionSelect.value === SUBSCRIPTION_BACKEND);
    if (keyArea) {
      keyArea.hidden = capable && connectionSelect.value === SUBSCRIPTION_BACKEND;
      for (const section of Array.from(keyArea.querySelectorAll<HTMLElement>('[data-nbinlineai-key-provider]'))) {
        section.hidden = capable && section.dataset.nbinlineaiKeyProvider !== connectionSelect.value;
      }
    }
  };
  connectionSelect.addEventListener('change', syncConnectionDetails);
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
      settings = state.settings;
      styleSelect.value = currentPromptMode();
      styleSelect.disabled = false;
      refreshInstructionEditors();
      styleRetry.hidden = true;
      styleNotice.textContent = `${promptModeLabel(currentPromptMode())} is the current response style.`;
    }).catch(() => {
      styleSelect.disabled = true;
      styleNotice.textContent = state.settingsError || state.settingsWarning || 'Could not reload response style settings. Choose Retry.';
    }).finally(() => { styleRetry.disabled = false; });
  });
  body.node.append(styleHeading, styleSelect, styleDescription, styleNotice, styleRetry);
  void settingsReady.then(() => {
    settings = state.settings;
    syncDefaultBackend();
    if (state.settingsError || !settings) {
      styleNotice.textContent = state.settingsError || 'Response style settings are unavailable.';
      styleRetry.hidden = !state.settingRegistry;
      return;
    }
    styleSelect.value = currentPromptMode();
    styleSelect.disabled = false;
    refreshInstructionEditors();
    styleRetry.hidden = !state.settingsWarning;
    styleNotice.textContent = state.settingsWarning || '';
  });
  defaultSelect.addEventListener('change', () => {
    if (!settings || !isBackend(defaultSelect.value)) return;
    const chosen = defaultSelect.value;
    const previous = settings.get('defaultBackend').composite;
    defaultSelect.disabled = true;
    defaultNotice.textContent = 'Saving default connection…';
    void settings.set('defaultBackend', chosen).then(() => {
      syncDefaultBackend();
      defaultNotice.textContent = settings?.get('defaultBackend').composite === chosen
        ? `${PROVIDERS[chosen].label} is now your default for new notebooks.`
        : 'Saved default differs from your choice. Reopen Configure AI to check it.';
      tracker.forEach(decorate);
    }).catch(() => {
      defaultSelect.value = isBackend(previous) ? previous : 'openai_api';
      defaultNotice.textContent = 'Could not save the default connection. Try again.';
    }).finally(() => { defaultSelect.disabled = false; });
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
    state.modeSavePending = true;
    styleNotice.textContent = 'Saving response style…';
    void settings.set('promptMode', chosen).then(() => {
      const authoritative = normalizePromptMode(settings?.get('promptMode').composite);
      state.confirmedPromptMode = authoritative;
      styleSelect.value = authoritative;
      state.settingsWarning = authoritative === chosen ? null : 'Saved response style differs from the requested style.';
      styleRetry.hidden = !state.settingsWarning;
      styleNotice.textContent = authoritative === chosen
        ? `${promptModeLabel(chosen)} is now your user default for notebooks without a style override.`
        : `The saved response style is ${promptModeLabel(authoritative)}. Choose Retry response style settings to check it.`;
      tracker.forEach(decorate);
    }).catch(() => {
      state.confirmedPromptMode = previous;
      styleSelect.value = previous;
      state.settingsWarning = 'Could not confirm the response style save.';
      styleRetry.hidden = false;
      styleNotice.textContent = 'Could not confirm the response style save. Choose Retry response style settings to check what was saved.';
      tracker.forEach(decorate);
    }).finally(() => { state.modeSavePending = false; styleSelect.disabled = false; });
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
      const custom = state.confirmedInstructions[mode];
      const serverDefault = env.getServerStatus()?.prompt_mode_instructions?.[mode] || '';
      if (document.activeElement !== row.textarea) row.textarea.value = custom || serverDefault;
      row.label.textContent = state.instructionNotices[mode] || (custom ? 'Custom instructions saved' : serverDefault ? 'Using server default' : 'Server default unavailable');
      row.reset.disabled = !settings || state.instructionsSavePending || !custom;
      row.save.disabled = !settings || state.instructionsSavePending;
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
    const statusLabel = document.createElement('span');
    statusLabel.className = 'nbinlineai-template-state';
    statusLabel.setAttribute('role', 'status');
    const save = document.createElement('button');
    save.type = 'button'; save.textContent = 'Save'; save.dataset.nbinlineaiInstructionSave = mode;
    const reset = document.createElement('button');
    reset.type = 'button'; reset.textContent = 'Reset'; reset.dataset.nbinlineaiInstructionReset = mode;
    templateRows.set(mode, { textarea, label: statusLabel, save, reset });
    const writeTemplate = async (custom: string | undefined) => {
      if (!settings) { statusLabel.textContent = 'Response style settings are unavailable. Nothing was saved.'; return; }
      if (state.instructionsSavePending) return;
      const next = { ...state.confirmedInstructions };
      if (custom) next[mode] = custom;
      else delete next[mode];
      save.disabled = true; reset.disabled = true;
      state.instructionsSavePending = true;
      refreshInstructionEditors();
      statusLabel.textContent = custom ? 'Saving custom instructions…' : 'Resetting to server default…';
      try {
        await settings.set('promptInstructions', next);
        const authoritative = readInstructionOverrides(settings.get('promptInstructions').composite);
        state.confirmedInstructions = authoritative;
        if ((authoritative[mode] || '') === (custom || '')) {
          state.settingsWarning = null;
          styleRetry.hidden = true;
          state.instructionNotices[mode] = custom ? 'Custom instructions saved for future runs.' : 'Using server default for future runs.';
        } else {
          state.settingsWarning = 'Could not confirm preset instructions.';
          styleRetry.hidden = false;
          state.instructionNotices[mode] = 'Saved instructions differ from the requested change. Choose Retry response style settings.';
        }
        refreshInstructionEditors();
      } catch {
        state.settingsWarning = 'Could not confirm preset instructions save.';
        styleRetry.hidden = false;
        state.instructionNotices[mode] = 'Could not confirm this change. Choose Retry response style settings to check what was saved.';
      } finally {
        state.instructionsSavePending = false;
        refreshInstructionEditors();
        tracker.forEach(decorate);
      }
    };
    save.addEventListener('click', () => {
      const custom = textarea.value.trim();
      if (!custom) { statusLabel.textContent = 'Enter nonblank instructions or choose Reset.'; return; }
      if (textarea.value.length > 8000) { statusLabel.textContent = 'Instructions must be 8000 characters or fewer.'; return; }
      void writeTemplate(textarea.value);
    });
    reset.addEventListener('click', () => { void writeTemplate(undefined); });
    row.append(rowHeading, name, statusLabel, save, reset);
    templateDetails.appendChild(row);
  }
  refreshInstructionEditors();
  const keysHeading = document.createElement('h3');
  keysHeading.textContent = 'API keys';
  keyArea = document.createElement('section');
  keyArea.className = 'nbinlineai-api-key-area';
  body.node.appendChild(keyArea);
  keyArea.appendChild(keysHeading);
  const intro = document.createElement('p');
  intro.textContent = 'Add your own API key for each provider you want to use. Saved keys stay on the computer running JupyterLab, outside notebooks, and are reused across your local Jupyter environments. Removing a saved key removes it for those environments too.';
  keyArea.appendChild(intro);
  const notice = document.createElement('div');
  notice.className = 'nbinlineai-key-notice';
  notice.setAttribute('role', 'status');
  keyArea.appendChild(notice);
  const rows = new Map<ApiBackend, { input: HTMLInputElement; save: HTMLButtonElement; remove: HTMLButtonElement; status: HTMLElement }>();
  let keyStatus: KeyStatus | null = null;
  const pending = new Set<ApiBackend>();
  let keysAvailable = false;
  let keyLoadFailed = false;
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = 'Retry';
  retry.dataset.nbinlineaiKeyRetry = '';
  retry.hidden = true;
  keyArea.appendChild(retry);
  const updateRows = () => {
    for (const backend of API_BACKENDS) {
      const row = rows.get(backend)!;
      const current = keyStatus?.providers?.[backend];
      row.status.textContent = keyLoadFailed ? 'Settings unavailable' : !current ? 'Checking…' : current.source === 'saved' ? 'Saved on this computer' : current.source === 'environment' ? 'Configured by server administrator' : 'Not configured';
      row.remove.disabled = !keysAvailable || pending.has(backend) || !current || current.source !== 'saved';
      row.save.disabled = !keysAvailable || pending.has(backend) || !row.input.value.trim();
    }
  };
  for (const backend of API_BACKENDS) {
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
    keyArea.appendChild(section);
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
        syncConnectionDetails();
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
  syncConnectionDetails();
  void loadKeys();
  try {
    await showDialog({ title: 'Configure AI', body, buttons: [Dialog.okButton({ label: 'Done' })] });
  } finally {
    subscriptionSetup.dispose();
    for (const row of rows.values()) row.input.value = '';
  }
}
