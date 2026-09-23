export type PromptMode = 'compact' | 'full' | 'learning';

export function promptMode(value: unknown): PromptMode {
  return value === 'full' || value === 'learning' ? value : 'compact';
}

export function promptModeLabel(mode: PromptMode): string {
  return mode === 'full' ? 'Full' : mode === 'learning' ? 'Learning' : 'Compact';
}
