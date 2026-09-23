/** Pure helpers for the model picker and server setup guidance. */
export const DEFAULT_MODEL = '__nbinlineai_default__';
export const CUSTOM_MODEL = '__nbinlineai_custom__';

export function availableModels(models: readonly string[] | undefined): string[] {
  return Array.from(new Set((models || []).filter(value => !!value && value !== DEFAULT_MODEL && value !== CUSTOM_MODEL)));
}

export function selectedModelChoice(savedModel: string | undefined, models: readonly string[]): string {
  if (!savedModel) return DEFAULT_MODEL;
  return models.includes(savedModel) ? savedModel : CUSTOM_MODEL;
}

export function resolvedDefault(settingModel: string | undefined, serverDefault: string | undefined): string {
  return settingModel || serverDefault || '';
}

export function serverUnavailableMessage(feature: 'settings' | 'prompt'): string {
  const action = feature === 'settings' ? 'choose Retry' : 'run the prompt again';
  return `The nbinlineai server endpoint is unavailable. If you just installed or updated the extension, restart the whole Jupyter server, then ${action}. A kernel restart or browser reload does not restart the server.`;
}

/** Never expose an HTML error page or raw upstream response in notebook output. */
export function promptHttpErrorMessage(status: number): string {
  if (status === 404) return serverUnavailableMessage('prompt');
  if (status === 400) return 'The AI request was rejected (400). Check the provider, model, and prompt.';
  if (status === 401 || status === 403) return `The Jupyter server denied the AI request (${status}). Sign in again and retry.`;
  if (status === 429) return 'The AI provider is busy or has reached a rate limit (429). Try again later.';
  return `The AI server returned an error (${status}). Try again or check the Jupyter server log.`;
}
