/** Undefined inherits the server default; an empty string explicitly disables it. */
export function readCommonOverride(value: unknown): string | undefined {
  return typeof value === 'string' && value.length <= 8000 ? value : undefined;
}

export function commonRequestFields(confirmed: string | undefined): { common_instructions?: string } {
  return confirmed === undefined ? {} : { common_instructions: confirmed };
}
