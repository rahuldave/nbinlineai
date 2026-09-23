/** Existing completed answers are protected unless the prompt explicitly allows reruns. */
export function keepsCompletedAnswer(
  keepAnswer: boolean | undefined,
  output: { status?: string; source: string } | null
): boolean {
  return keepAnswer !== false && output?.status === 'done' && !!output.source.trim();
}
