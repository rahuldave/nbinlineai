export type Backend = 'openai_api' | 'anthropic_api';
export type Availability = Record<Backend, { configured: boolean }> | null;

export function configured(availability: Availability, backend: Backend): boolean | null {
  return availability ? !!availability[backend]?.configured : null;
}

/** New cells follow the sole usable provider; two usable providers honor the setting. */
export function defaultProvider(preferred: Backend, availability: Availability): Backend {
  if (!availability) return preferred;
  const usable = (['openai_api', 'anthropic_api'] as Backend[]).filter(backend => configured(availability, backend));
  return usable.length === 1 ? usable[0] : preferred;
}

/** An explicit saved provider is never rewritten just because a key is absent. */
export function cellProvider(saved: Backend | undefined, preferred: Backend, availability: Availability): Backend {
  return saved || defaultProvider(preferred, availability);
}
