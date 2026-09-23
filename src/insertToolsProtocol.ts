/** Small, versioned payload for kernel-requested tool notes. */
export const INSERT_TOOLS_TARGET = 'nbinlineai.insert_tools.v1';
const MAX_MARKDOWN_CHARS = 8000;

export interface InsertRequest {
  version: 1;
  content: string;
  source_cell_id: string;
  execute_request_id: string;
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
