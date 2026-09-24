import { Backend, SUBSCRIPTION_BACKEND } from './providerChoice';

export type SubscriptionState = 'missing_runtime' | 'incompatible_runtime' | 'installing' |
  'signed_out' | 'connecting' | 'connected' | 'expired' | 'limited' | 'offline' | 'error';

export interface SubscriptionStatus {
  state: SubscriptionState;
  configured: boolean;
  account?: { display_name?: string; email?: string; workspace?: string };
  models: Array<{ id: string; display_name?: string; efforts: string[]; default_effort?: string | null }>;
  usage: { state: 'available' | 'unavailable' | 'limited'; message?: string; reset_at?: string | null; remaining_percent?: number };
  project_root?: string;
  working_folder?: string;
  file_access: 'project' | 'notebook';
  native_files_capable?: boolean;
  message?: string;
}

interface LoginResult {
  login_id: string;
  state: 'connecting';
  auth_url?: string;
  device_code?: string;
  verification_url?: string;
}

export interface SubscriptionSetupEnvironment {
  capable: () => boolean;
  sessionId: () => string | null;
  notebookChoice: () => { backend?: Backend; model?: string; reasoningEffort?: string };
  useForNotebook: (model: string, effort: string | undefined) => void;
  request: <T>(path: string, method?: 'GET' | 'POST', body?: object) => Promise<T>;
  refreshProviders: () => Promise<void>;
}

const stateLabels: Record<SubscriptionState, string> = {
  missing_runtime: 'ChatGPT runtime is not installed on this server.',
  incompatible_runtime: 'This ChatGPT runtime is not compatible.',
  installing: 'ChatGPT setup is in progress…',
  signed_out: 'Connect your ChatGPT account.',
  connecting: 'Waiting for ChatGPT sign-in…',
  connected: 'ChatGPT connected.',
  expired: 'ChatGPT sign-in expired. Sign in again.',
  limited: 'ChatGPT usage limit reached.',
  offline: 'ChatGPT connection is offline. Retry when the server is available.',
  error: 'ChatGPT connection could not start. Retry.'
};

export function subscriptionStatusText(status: SubscriptionStatus): string {
  return status.message || stateLabels[status.state] || stateLabels.error;
}

export function subscriptionUsageText(usage: SubscriptionStatus['usage']): string {
  if (usage.state === 'limited') return usage.reset_at
    ? `Usage limit reached. Resets ${usage.reset_at}. No automatic API fallback.`
    : 'Usage limit reached. No automatic API fallback.';
  if (usage.state === 'unavailable') return 'Usage information is unavailable. Account limits still apply.';
  const remaining = typeof usage.remaining_percent === 'number' && Number.isFinite(usage.remaining_percent) &&
    usage.remaining_percent >= 0 && usage.remaining_percent <= 100
    ? `${usage.remaining_percent}% remaining. ` : '';
  return remaining + (usage.message || 'Usage limits are shared across your account. Additional ChatGPT credits may apply.');
}

function signInUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:') throw new Error('ChatGPT returned an invalid sign-in link. Retry.');
  return parsed.toString();
}

function textElement(tag: string, content: string, className?: string): HTMLElement {
  const node = document.createElement(tag);
  node.textContent = content;
  if (className) node.className = className;
  return node;
}

export class SubscriptionSetup {
  readonly node = document.createElement('section');
  private readonly statusLine = textElement('strong', 'Checking ChatGPT…');
  private readonly accountLine = textElement('span', 'Uses your ChatGPT subscription allowance.', 'nbinlineai-connection-detail');
  private readonly feedback = textElement('div', '', 'nbinlineai-connection-feedback');
  private readonly usageLine = textElement('span', 'Usage information is unavailable.', 'nbinlineai-connection-detail');
  private readonly paths = textElement('div', '', 'nbinlineai-connection-paths');
  private readonly model = document.createElement('select');
  private readonly effort = document.createElement('select');
  private readonly scope = document.createElement('select');
  private readonly scopeControl = document.createElement('div');
  private readonly scopeSelector = textElement('label', 'ChatGPT file access');
  private readonly scopeStatic = document.createElement('div');
  private readonly scopeReadOnly = textElement('span', 'Notebook tools only — direct ChatGPT file operations are off.', 'nbinlineai-connection-detail');
  private readonly browserLogin = this.button('Sign in with ChatGPT', 'login');
  private readonly deviceLogin = this.button('Use device code', 'device-login');
  private readonly cancelLogin = this.button('Cancel sign-in', 'cancel-login');
  private readonly disconnect = this.button('Disconnect', 'disconnect');
  private readonly refreshButton = this.button('Check connection', 'refresh');
  private readonly refreshUsage = this.button('Refresh usage', 'refresh-usage');
  private readonly use = this.button('Use for this notebook', 'use');
  private readonly loginDetails = textElement('div', '', 'nbinlineai-connection-login-details');
  private status: SubscriptionStatus | null = null;
  private loginId: string | null = null;
  private timer: number | null = null;
  private busy = false;
  private disposed = false;
  private visible = false;

  constructor(private readonly env: SubscriptionSetupEnvironment) {
    this.node.className = 'nbinlineai-subscription-setup';
    this.node.dataset.nbinlineaiSubscriptionSetup = '';
    this.node.hidden = true;
    this.feedback.setAttribute('role', 'status');
    this.model.dataset.nbinlineaiSubscriptionModel = '';
    this.model.setAttribute('aria-label', 'ChatGPT model');
    this.effort.dataset.nbinlineaiSubscriptionEffort = '';
    this.effort.setAttribute('aria-label', 'ChatGPT reasoning effort');
    this.scope.dataset.nbinlineaiSubscriptionScope = '';
    this.scope.setAttribute('aria-label', 'ChatGPT file access');
    for (const [value, label] of [['project', 'JupyterLab project folder'], ['notebook', 'This notebook’s folder']]) {
      const option = document.createElement('option');
      option.value = value; option.textContent = label; this.scope.appendChild(option);
    }
    const modelLabel = textElement('label', 'Model'); modelLabel.appendChild(this.model);
    const effortLabel = textElement('label', 'Reasoning effort'); effortLabel.appendChild(this.effort);
    this.scopeSelector.append(this.scope,
      textElement('span', 'Applies to direct ChatGPT operations. Python keeps its normal permissions.', 'nbinlineai-connection-detail'));
    this.scopeStatic.className = 'nbinlineai-subscription-scope-static';
    this.scopeStatic.dataset.nbinlineaiSubscriptionScopeStatic = '';
    this.scopeStatic.append(textElement('strong', 'ChatGPT file access'), this.scopeReadOnly,
      textElement('span', 'Applies to direct ChatGPT operations. Python keeps its normal permissions.', 'nbinlineai-connection-detail'));
    this.scopeControl.append(this.scopeStatic);
    const actions = document.createElement('div'); actions.className = 'nbinlineai-connection-actions';
    actions.append(this.browserLogin, this.deviceLogin, this.cancelLogin, this.disconnect, this.refreshButton);
    const useRow = document.createElement('div'); useRow.className = 'nbinlineai-connection-actions';
    useRow.append(this.use);
    const details = document.createElement('details');
    details.append(textElement('summary', 'File access and usage'),
      textElement('p', 'The notebook folder supplies location context. Built-in ChatGPT file, shell and browser tools are off. Enabled notebook tools run separately in Python with your permissions.'),
      this.usageLine, this.refreshUsage,
      textElement('p', 'Usage limits are shared across your account. Additional ChatGPT credits may apply. API access is a separate choice.'),
      textElement('p', 'Each notebook has its own conversation and tools. Your ChatGPT sign-in is shared.'));
    this.node.append(this.statusLine, this.accountLine, actions, this.loginDetails, modelLabel, effortLabel,
      this.paths, this.scopeControl, details,
      textElement('span', 'Disconnect stops this Jupyter server connection. It does not sign you out of other apps or projects.', 'nbinlineai-connection-detail'),
      useRow, this.feedback);
    this.browserLogin.addEventListener('click', () => { void this.startLogin('browser'); });
    this.deviceLogin.addEventListener('click', () => { void this.startLogin('device'); });
    this.cancelLogin.addEventListener('click', () => { void this.cancel(); });
    this.disconnect.addEventListener('click', () => { void this.perform('subscription/disconnect', 'ChatGPT disconnected from this Jupyter server.'); });
    this.refreshButton.addEventListener('click', () => { void this.refresh(); });
    this.refreshUsage.addEventListener('click', () => { void this.refreshUsageInfo(); });
    this.scope.addEventListener('change', () => { void this.changeScope(); });
    this.model.addEventListener('change', () => this.renderEfforts());
    this.use.addEventListener('click', () => this.useForNotebook());
  }

  setVisible(value: boolean): void {
    const wasVisible = this.visible;
    this.visible = value && this.env.capable();
    this.node.hidden = !this.visible;
    if (this.visible && (!wasVisible || !this.status)) void this.refresh();
    else this.clearTimer();
  }

  private button(label: string, action: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = label; button.dataset.nbinlineaiSubscriptionAction = action;
    return button;
  }

  private clearTimer(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
  }

  private scheduleRefresh(): void {
    this.clearTimer();
    if (this.visible && !this.disposed && this.status?.state === 'connecting') {
      this.timer = window.setTimeout(() => { void this.refresh(); }, 2500);
    }
  }

  private path(path: 'status' | 'file-access'): string {
    const sessionId = this.env.sessionId();
    if (!sessionId) {
      if (path === 'status') return 'subscription/status';
      throw new Error('Open a notebook with a running kernel to change ChatGPT file access.');
    }
    return `subscription/${path}?${new URLSearchParams({ session_id: sessionId })}`;
  }

  async refresh(): Promise<void> {
    if (!this.visible || !this.env.capable() || this.disposed) return;
    this.clearTimer();
    try {
      this.status = await this.env.request<SubscriptionStatus>(this.path('status'));
      if (this.disposed || !this.visible) return;
      if (this.status.state === 'connected' || this.status.state === 'limited') {
        this.loginId = null;
        this.loginDetails.replaceChildren();
      }
      this.feedback.textContent = '';
      this.render();
      await this.env.refreshProviders();
      this.scheduleRefresh();
    } catch (error) {
      if (this.disposed || !this.visible) return;
      this.status = null;
      this.statusLine.textContent = 'ChatGPT connection unavailable.';
      this.feedback.textContent = error instanceof Error ? error.message : 'Could not check ChatGPT connection.';
      this.render();
    }
  }

  private render(): void {
    const status = this.status;
    if (status) {
      this.statusLine.textContent = subscriptionStatusText(status);
      const account = [status.account?.display_name || status.account?.email, status.account?.workspace].filter(Boolean).join(' · ');
      this.accountLine.textContent = account ? `${account} · Uses your ChatGPT subscription allowance.` :
        'Uses your ChatGPT subscription allowance.';
      this.usageLine.textContent = subscriptionUsageText(status.usage);
      this.paths.replaceChildren();
      if (status.working_folder) this.paths.append(textElement('span', `Notebook folder: ${status.working_folder}`));
      if (status.project_root) this.paths.append(textElement('span', `JupyterLab project folder: ${status.project_root}`));
      this.scope.value = status.file_access;
      const scopeView = status.native_files_capable === true ? this.scopeSelector : this.scopeStatic;
      if (this.scopeControl.firstElementChild !== scopeView) this.scopeControl.replaceChildren(scopeView);
      const saved = this.env.notebookChoice();
      const savedModel = saved.backend === SUBSCRIPTION_BACKEND ? saved.model || '' : '';
      const previousModel = this.model.value || savedModel;
      this.model.replaceChildren();
      for (const model of status.models || []) {
        const option = document.createElement('option');
        option.value = model.id; option.textContent = model.display_name || model.id; this.model.appendChild(option);
      }
      const chosen = previousModel || status.models?.[0]?.id || '';
      if (chosen && !status.models?.some(item => item.id === chosen)) {
        const unavailable = document.createElement('option');
        unavailable.value = chosen; unavailable.textContent = `${chosen} — unavailable`; unavailable.disabled = true;
        this.model.appendChild(unavailable);
      }
      this.model.value = chosen;
      this.renderEfforts();
    }
    const signedIn = status?.state === 'connected' || status?.state === 'limited';
    const canSignIn = status?.state === 'signed_out' || status?.state === 'expired' || status?.state === 'error';
    this.browserLogin.hidden = !canSignIn;
    this.deviceLogin.hidden = !canSignIn;
    this.cancelLogin.hidden = !this.loginId;
    this.disconnect.hidden = !signedIn;
    this.browserLogin.disabled = this.busy || !this.env.capable();
    this.deviceLogin.disabled = this.busy || !this.env.capable();
    this.cancelLogin.disabled = this.busy || !this.loginId;
    this.disconnect.disabled = this.busy;
    this.refreshButton.disabled = this.busy;
    this.scope.disabled = this.busy || status?.native_files_capable !== true || !status?.working_folder || !status?.project_root;
    this.model.disabled = !signedIn || !status?.models?.length;
    this.effort.disabled = this.model.disabled;
    const chosenModel = status?.models?.find(item => item.id === this.model.value);
    const effortAvailable = !this.effort.value || !!chosenModel?.efforts?.includes(this.effort.value);
    this.use.disabled = this.busy || !signedIn || !status?.configured || !chosenModel || !effortAvailable || !this.env.sessionId();
  }

  private renderEfforts(): void {
    const model = this.status?.models?.find(item => item.id === this.model.value);
    const saved = this.env.notebookChoice();
    const savedEffort = saved.backend === SUBSCRIPTION_BACKEND && saved.reasoningEffort !== 'default'
      ? saved.reasoningEffort || '' : '';
    const previousEffort = this.effort.options.length ? this.effort.value : savedEffort;
    this.effort.replaceChildren();
    const defaultOption = document.createElement('option');
    defaultOption.value = ''; defaultOption.textContent = model?.default_effort ? `Model default (${model.default_effort})` : 'Model default';
    this.effort.appendChild(defaultOption);
    for (const value of model?.efforts || []) {
      const option = document.createElement('option'); option.value = value; option.textContent = value; this.effort.appendChild(option);
    }
    if (previousEffort && !model?.efforts?.includes(previousEffort)) {
      const unavailable = document.createElement('option');
      unavailable.value = previousEffort; unavailable.textContent = `${previousEffort} — unavailable`; unavailable.disabled = true;
      this.effort.appendChild(unavailable);
    }
    this.effort.value = previousEffort;
    this.renderUseOnly();
  }

  private renderUseOnly(): void {
    const selectedModel = this.status?.models?.find(item => item.id === this.model.value);
    const effortAvailable = !this.effort.value || !!selectedModel?.efforts?.includes(this.effort.value);
    const signedIn = this.status?.state === 'connected' || this.status?.state === 'limited';
    this.use.disabled = this.busy || !signedIn || !this.status?.configured || !selectedModel || !effortAvailable || !this.env.sessionId();
  }

  private async startLogin(method: 'browser' | 'device'): Promise<void> {
    if (!this.visible || !this.env.capable() || this.busy) return;
    // Reserve a user-initiated tab before awaiting the server; browsers block
    // popups opened only after the asynchronous login response arrives.
    const loginTab = method === 'browser' ? window.open('', '_blank') : null;
    if (loginTab) loginTab.opener = null;
    this.busy = true; this.feedback.textContent = 'Starting ChatGPT sign-in…'; this.render();
    try {
      const result = await this.env.request<LoginResult>('subscription/login', 'POST', { method });
      this.loginId = result.login_id;
      if (this.disposed) { loginTab?.close(); await this.cancel(); return; }
      this.loginDetails.replaceChildren();
      if (method === 'browser' && result.auth_url) {
        const url = signInUrl(result.auth_url);
        const link = document.createElement('a');
        link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
        link.textContent = 'Open ChatGPT sign-in page'; this.loginDetails.append(link);
        if (loginTab) loginTab.location.replace(url);
      } else if (method === 'device' && result.verification_url && result.device_code) {
        const url = signInUrl(result.verification_url);
        const link = document.createElement('a');
        link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
        link.textContent = 'Open device sign-in page';
        this.loginDetails.append(textElement('span', `Enter code: ${result.device_code}`), link);
      } else throw new Error('ChatGPT did not provide a sign-in link. Retry.');
      this.feedback.textContent = 'Waiting for ChatGPT sign-in. You can cancel here.';
      await this.refresh();
    } catch (error) {
      loginTab?.close();
      if (!this.disposed) this.feedback.textContent = error instanceof Error ? error.message : 'ChatGPT sign-in failed.';
    } finally { this.busy = false; if (!this.disposed) this.render(); }
  }

  private async cancel(): Promise<void> {
    const loginId = this.loginId;
    if (!loginId) return;
    this.clearTimer();
    try {
      await this.env.request('subscription/login/cancel', 'POST', { login_id: loginId });
      if (this.loginId === loginId) this.loginId = null;
      if (!this.disposed) { await this.refresh(); this.feedback.textContent = 'ChatGPT sign-in cancelled.'; }
    } catch (error) {
      if (!this.disposed) this.feedback.textContent = error instanceof Error ? error.message : 'Could not cancel ChatGPT sign-in.';
    }
  }

  private async perform(path: string, success: string): Promise<void> {
    if (!this.visible || !this.env.capable() || this.busy) return;
    this.busy = true; this.render();
    try {
      await this.env.request(path, 'POST', {});
      this.loginId = null;
      await this.refresh();
      this.feedback.textContent = success;
    } catch (error) {
      this.feedback.textContent = error instanceof Error ? error.message : 'ChatGPT action failed.';
    } finally { this.busy = false; this.render(); }
  }

  private async changeScope(): Promise<void> {
    if (!this.visible || !this.env.capable() || this.busy || this.status?.native_files_capable !== true) return;
    const scope = this.scope.value;
    if (scope !== 'project' && scope !== 'notebook') return;
    this.busy = true; this.render();
    try {
      await this.env.request(this.path('file-access'), 'POST', { scope, session_id: this.env.sessionId() });
      await this.refresh();
      this.feedback.textContent = `ChatGPT file access set to ${scope === 'project' ? 'the JupyterLab project folder' : 'this notebook’s folder'}.`;
    } catch (error) {
      this.feedback.textContent = error instanceof Error ? error.message : 'Could not save ChatGPT file access.';
      if (this.status) this.scope.value = this.status.file_access;
    } finally { this.busy = false; this.render(); }
  }

  private async refreshUsageInfo(): Promise<void> {
    if (!this.visible || !this.env.capable() || this.busy) return;
    try {
      const usage = await this.env.request<SubscriptionStatus['usage']>('subscription/usage');
      if (this.status) this.status.usage = usage;
      this.render();
    } catch (error) {
      this.feedback.textContent = error instanceof Error ? error.message : 'Usage information is unavailable.';
    }
  }

  private useForNotebook(): void {
    if (!this.visible || !this.env.capable() || this.use.disabled) return;
    try {
      this.env.useForNotebook(this.model.value, this.effort.value || undefined);
      this.feedback.textContent = 'This notebook now uses your ChatGPT subscription.';
    } catch (error) {
      this.feedback.textContent = error instanceof Error ? error.message : 'Could not update this notebook.';
    }
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
    if (this.loginId) void this.cancel();
  }
}
