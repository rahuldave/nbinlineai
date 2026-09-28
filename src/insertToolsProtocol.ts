/** Small, versioned payload for kernel-requested tool notes. */
export const INSERT_TOOLS_TARGET = 'nbinlineai.insert_tools.v1';
export const EXECUTION_HANDOFF_TARGET = 'nbinlineai.execution_handoff.v1';
const MAX_MARKDOWN_CHARS = 8000;

export interface InsertRequest {
  version: 1;
  content: string;
  source_cell_id: string;
  execute_request_id: string;
}

export interface ExecutionHandoffRequest {
  version: 1;
  operation: 'add_code_cell_and_execute' | 'prompt_and_run' | 'run_and_prompt';
  arguments: Record<string, unknown>;
  source_cell_id: string;
  execute_request_id: string;
  request_id: string;
}

export function parseExecutionHandoffRequest(value: unknown): ExecutionHandoffRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (data.version !== 1 || !['add_code_cell_and_execute', 'prompt_and_run', 'run_and_prompt'].includes(String(data.operation)) ||
      !data.arguments || typeof data.arguments !== 'object' || Array.isArray(data.arguments) ||
      typeof data.source_cell_id !== 'string' || !data.source_cell_id || data.source_cell_id.length > 200 ||
      typeof data.execute_request_id !== 'string' || !data.execute_request_id || data.execute_request_id.length > 200 ||
      typeof data.request_id !== 'string' || !data.request_id || data.request_id.length > 200) return null;
  return data as unknown as ExecutionHandoffRequest;
}

/** Validate data before any notebook mutation. */
export function parseInsertRequest(value: unknown): InsertRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (data.version !== 1 || typeof data.content !== 'string' || !data.content.trim() ||
      data.content.length > MAX_MARKDOWN_CHARS || typeof data.source_cell_id !== 'string' ||
      !data.source_cell_id || data.source_cell_id.length > 200 ||
      typeof data.execute_request_id !== 'string' || !data.execute_request_id ||
      data.execute_request_id.length > 200) return null;
  return data as unknown as InsertRequest;
}

/** Keep notes from repeated helper calls directly below their executing cell. */
export function insertionIndex(ids: string[], sourceId: string, lastInsertedId?: string): number {
  const sourceIndex = ids.indexOf(sourceId);
  if (sourceIndex < 0) throw new Error('The source code cell was removed.');
  const lastIndex = lastInsertedId ? ids.indexOf(lastInsertedId) : -1;
  return (lastIndex >= sourceIndex ? lastIndex : sourceIndex) + 1;
}
