export const API_BACKENDS = ['openai_api', 'anthropic_api'] as const;
export const SUBSCRIPTION_BACKEND = 'openai_codex_subscription' as const;
export const BACKENDS = [...API_BACKENDS, SUBSCRIPTION_BACKEND] as const;

export type ApiBackend = typeof API_BACKENDS[number];
export type Backend = typeof BACKENDS[number];
export type Availability = Partial<Record<Backend, { configured: boolean }>> | null;
export interface ProviderStatus {
  configured: boolean;
  source?: 'saved' | 'environment' | null;
  state?: string;
  default_model: string | null;
  models: string[];
}
export interface KeyStatus {
  providers: Record<ApiBackend, { configured: boolean; source: 'saved' | 'environment' | null }>;
}
export interface ServerStatus {
  subscription_capable?: boolean;
  providers: Partial<Record<Backend, ProviderStatus>>;
  default_models: Partial<Record<Backend, string | null>>;
  prompt_mode_instructions?: Record<'compact' | 'full' | 'learning', string>;
  model_capabilities?: Partial<Record<Backend, Record<string, { efforts: string[]; default_effort: string | null }>>>;
}

export interface ProviderDescriptor {
  id: Backend;
  label: string;
  shortLabel: string;
  kind: 'api' | 'subscription';
  unavailable: string;
}

export const PROVIDERS: Record<Backend, ProviderDescriptor> = {
  openai_api: { id: 'openai_api', label: 'OpenAI API', shortLabel: 'OpenAI', kind: 'api', unavailable: 'API key required' },
  anthropic_api: { id: 'anthropic_api', label: 'Anthropic API', shortLabel: 'Anthropic', kind: 'api', unavailable: 'API key required' },
  openai_codex_subscription: {
    id: 'openai_codex_subscription', label: 'ChatGPT subscription', shortLabel: 'ChatGPT',
    kind: 'subscription', unavailable: 'ChatGPT subscription unavailable'
  }
};

export function isBackend(value: unknown): value is Backend {
  return typeof value === 'string' && (BACKENDS as readonly string[]).includes(value);
}

export function configured(availability: Availability, backend: Backend): boolean | null {
  return availability ? !!availability[backend]?.configured : null;
}

/** A cell can change providers when an enabled connection can be selected. */
export function hasSelectableProvider(availability: Availability, subscriptionCapable: boolean): boolean {
  return API_BACKENDS.some(backend => configured(availability, backend) === true) ||
    (subscriptionCapable && configured(availability, SUBSCRIPTION_BACKEND) === true);
}

/** Subscription use is always a deliberate setting or notebook/cell choice. */
export function defaultProvider(preferred: Backend, availability: Availability): Backend {
  if (!availability || preferred === SUBSCRIPTION_BACKEND) return preferred;
  const usable = API_BACKENDS.filter(backend => configured(availability, backend));
  return usable.length === 1 ? usable[0] : preferred;
}

/** An explicit saved provider is never rewritten just because a key is absent. */
export function cellProvider(saved: Backend | undefined, preferred: Backend, availability: Availability): Backend {
  return saved || defaultProvider(preferred, availability);
}

/** Do not offer subscription for new choices until the server reports it ready. */
export function visibleBackends(availability: Availability, saved?: Backend): Backend[] {
  return BACKENDS.filter(backend => backend !== SUBSCRIPTION_BACKEND || availability?.[backend]?.configured === true || saved === backend);
}

export function unavailableMessage(backend: Backend, anyApiConfigured: boolean): string {
  if (backend === SUBSCRIPTION_BACKEND) return 'ChatGPT subscription unavailable. Your selection is kept.';
  return anyApiConfigured
    ? 'API key required. Choose Configure AI or another provider.'
    : 'No API key configured. Choose Configure AI.';
}

/** Keep unavailable ChatGPT choices explicit instead of silently choosing a different model or effort. */
export function subscriptionSelectionIssue(status: ServerStatus | null, model: string, effort: string): string | null {
  const provider = status?.providers?.[SUBSCRIPTION_BACKEND];
  if (!status?.subscription_capable || !provider?.configured) return null;
  const modelId = model || provider.default_model || '';
  if (!modelId || !provider.models.includes(modelId)) {
    return 'Selected ChatGPT model is unavailable. Choose an available model.';
  }
  if (effort && effort !== 'default' &&
      !status.model_capabilities?.[SUBSCRIPTION_BACKEND]?.[modelId]?.efforts.includes(effort)) {
    return 'Selected ChatGPT reasoning effort is unavailable for this model. Choose another effort.';
  }
  return null;
}

/** Interpret a refreshed connection state without exposing an upstream error body. */
export function subscriptionConnectionErrorMessage(status: ServerStatus | null): string | null {
  const state = status?.providers?.[SUBSCRIPTION_BACKEND]?.state;
  if (state === 'expired') return 'ChatGPT sign-in expired. Open Configure AI to sign in again.';
  if (state === 'signed_out') return 'ChatGPT is disconnected. Open Configure AI to sign in.';
  if (state === 'limited') return 'ChatGPT usage limit reached. Open Configure AI to check your usage.';
  if (state === 'connecting') return 'ChatGPT sign-in is still in progress. Open Configure AI to check it.';
  if (state === 'offline' || state === 'missing_runtime' || state === 'incompatible_runtime' || state === 'error') {
    return 'ChatGPT connection unavailable. Open Configure AI to check it.';
  }
  return null;
}
