import { Backend, Availability, defaultProvider } from './providerChoice';
import { PromptMode } from './promptMode';
import { ContextMode } from './context';

export interface AIDefaults {
  backend?: Backend;
  model?: string;
  promptMode?: PromptMode;
  reasoningEffort?: string;
  keepAnswers?: boolean;
  contextMode?: ContextMode;
}
export interface AIOverrides extends AIDefaults {}
export interface ResolvedAI {
  backend: Backend;
  model: string;
  promptMode: PromptMode;
  reasoningEffort: string;
}

/** A model default belongs to its provider and must never cross provider boundaries. */
export function resolveAI(
  cell: AIOverrides,
  notebook: AIDefaults,
  user: { backend: Backend; models: Partial<Record<Backend, string>>; promptMode: PromptMode },
  availability: Availability
): ResolvedAI {
  const notebookBackend = notebook.backend || defaultProvider(user.backend, availability);
  const backend = cell.backend || notebookBackend;
  const notebookModel = backend === notebookBackend ? notebook.model || '' : '';
  return {
    backend,
    model: cell.model || notebookModel || user.models[backend] || '',
    promptMode: cell.promptMode || notebook.promptMode || user.promptMode,
    reasoningEffort: cell.reasoningEffort || (backend === notebookBackend ? notebook.reasoningEffort || '' : '')
  };
}

export function hasOverride(cell: AIOverrides): boolean {
  return !!(cell.backend || cell.model || cell.promptMode || cell.reasoningEffort);
}

/** Unsupported effort settings fall back to the selected model's default. */
export function supportedEffort(effort: string, choices: readonly string[] | undefined): string {
  return effort && choices?.includes(effort) ? effort : '';
}

/** Capture effective values once; later explicit header edits may clear individual fields. */
export function snapshotDefaults(existing: AIDefaults, effective: ResolvedAI): AIDefaults {
  return {
    backend: existing.backend || effective.backend,
    model: existing.model || effective.model,
    promptMode: existing.promptMode || effective.promptMode,
    reasoningEffort: existing.reasoningEffort || effective.reasoningEffort || 'default',
    keepAnswers: existing.keepAnswers ?? true,
    ...(existing.contextMode ? { contextMode: existing.contextMode } : {})
  };
}
