/** A cell may override the notebook default; old notebooks default to protecting answers. */
export function effectiveKeepAnswer(cell: boolean | undefined, notebook: boolean | undefined): boolean {
  return cell ?? notebook ?? true;
}

/** Existing completed answers are protected unless the effective setting allows reruns. */
export function keepsCompletedAnswer(
  keepAnswer: boolean,
  output: { status?: string; source: string } | null
): boolean {
  return keepAnswer && output?.status === 'done' && !!output.source.trim();
}
