/** Keep a deliberately pasted text reply within the server's Python JSON bound. */
import { resultFits } from './browserMediaResultBudget';

export interface BoundedPasteResult extends Record<string, unknown> {
  text: string;
  truncated: boolean;
  original_chars: number;
}

export function boundedPasteResult(text: string): BoundedPasteResult {
  const characters = Array.from(text);
  const originalChars = characters.length;
  const complete = { text, truncated: false, original_chars: originalChars };
  if (resultFits(complete)) return complete;
  let low = 0;
  let high = originalChars;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = { text: characters.slice(0, middle).join(''),
      truncated: true, original_chars: originalChars };
    if (resultFits(candidate)) low = middle;
    else high = middle - 1;
  }
  return { text: characters.slice(0, low).join(''), truncated: true,
    original_chars: originalChars };
}
