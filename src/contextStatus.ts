/** Character-based context accounting reported by the Jupyter server. */
export interface ContextReport {
  includedCells: number;
  submittedCells: number;
  omittedCells: number;
  partialCells: number;
  contextChars: number;
  budgetChars: number;
  toolSchemaChars: number;
  tools: string[];
  sourceTruncated: boolean;
  historyTruncated: boolean;
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Return null for an older or malformed context event; callers keep the old status fallback. */
export function parseContextReport(event: Record<string, unknown>): ContextReport | null {
  const includedCells = count(event.cell_count);
  const submittedCells = count(event.preceding_cell_count);
  const omittedCells = count(event.omitted_cell_count);
  const partialCells = count(event.partial_cell_count);
  const contextChars = count(event.context_chars);
  const budgetChars = count(event.context_budget_chars);
  const toolSchemaChars = count(event.tool_schema_chars);
  const tools = event.tools;
  if (includedCells === null || submittedCells === null || omittedCells === null || partialCells === null ||
      contextChars === null || budgetChars === null || budgetChars === 0 || toolSchemaChars === null ||
      includedCells > submittedCells || partialCells > includedCells ||
      !Array.isArray(tools) || tools.length > 20 || tools.some(tool => typeof tool !== 'string' || !tool || tool.length > 200) ||
      typeof event.source_truncated !== 'boolean' || typeof event.history_truncated !== 'boolean') return null;
  return {
    includedCells, submittedCells, omittedCells, partialCells, contextChars, budgetChars,
    toolSchemaChars, tools: tools as string[],
    sourceTruncated: event.source_truncated, historyTruncated: event.history_truncated
  };
}

export function contextWasTrimmed(report: ContextReport): boolean {
  return report.omittedCells > 0 || report.partialCells > 0 || report.sourceTruncated || report.historyTruncated;
}

export function runningContextText(report: ContextReport): string {
  return `Using ${report.includedCells} ${report.includedCells === 1 ? 'cell' : 'cells'} · ${report.tools.length} ${report.tools.length === 1 ? 'tool' : 'tools'}…`;
}

export function runningProgressText(message: string, report: ContextReport | null): string {
  return report ? `${message} · ${report.includedCells} cells · ${report.tools.length} tools` : message;
}

export function completedContextText(trimmed: boolean): string {
  return trimmed ? 'Done · context trimmed' : 'Done';
}

export function contextTooltip(report: ContextReport, trimmedInEarlierRound = false): string {
  const tools = report.tools.length ? report.tools.join(', ') : 'none';
  const earlier = trimmedInEarlierRound && !contextWasTrimmed(report)
    ? 'An earlier provider round trimmed context. ' : '';
  return `${earlier}${report.includedCells} included of ${report.submittedCells} submitted preceding cells; ` +
    `${report.omittedCells} omitted eligible cells; ${report.partialCells} partial cells. ` +
    `Tools (${report.tools.length}): ${tools}. ` +
    `Character estimate: ${report.contextChars.toLocaleString('en-US')} / ${report.budgetChars.toLocaleString('en-US')} budget; ` +
    `tool schemas: ${report.toolSchemaChars.toLocaleString('en-US')} characters. ` +
    `Source trimmed: ${report.sourceTruncated ? 'yes' : 'no'}; history trimmed: ${report.historyTruncated ? 'yes' : 'no'}. ` +
    'These are character estimates, not tokens or exact model usage.';
}
