/** Conservative bound for MediaRegistry.transition's Python json.dumps(result) limit. */
export const MEDIA_RESULT_CHAR_LIMIT = 1400; // Server admits at most 1500 characters.

function stringChars(value: string): number {
  const encoded = JSON.stringify(value);
  let length = 0;
  for (const character of encoded) {
    const point = character.codePointAt(0)!;
    length += point > 0xffff ? 12 : point > 127 ? 6 : 1;
  }
  return length;
}

/** Include Python's default comma/colon spaces and ensure_ascii escapes. */
export function pythonResultChars(value: unknown): number {
  if (value === null || value === undefined) return 4;
  if (typeof value === 'string') return stringChars(value);
  if (typeof value === 'boolean') return value ? 4 : 5;
  if (typeof value === 'number') return (JSON.stringify(value) || 'null').length + 8;
  if (Array.isArray(value)) return 2 + value.reduce<number>((sum, item, index) =>
    sum + pythonResultChars(item) + (index ? 2 : 0), 0);
  if (typeof value === 'object') {
    let length = 2;
    for (const [index, [key, item]] of Object.entries(value).entries())
      length += stringChars(key) + 2 + pythonResultChars(item) + (index ? 2 : 0);
    return length;
  }
  return 32;
}

export function resultFits(value: unknown): boolean {
  return pythonResultChars(value) <= MEDIA_RESULT_CHAR_LIMIT;
}

/** Do not stringify an enormous live table merely to return a 1400-char page. */
export function preflightStructured(value: unknown, maxUnits = 250_000): void {
  const pending = [value];
  const seen = new WeakSet<object>();
  let units = 0;
  while (pending.length) {
    const item = pending.pop();
    units++;
    if (typeof item === 'string') units += item.length;
    else if (item && typeof item === 'object') {
      if (seen.has(item)) throw new Error('Structured output contains a cycle.');
      seen.add(item);
      if (Array.isArray(item)) {
        units += item.length;
        if (units > maxUnits) throw new Error('Structured output is too large to serialize.');
        for (const part of item) pending.push(part);
      } else {
        for (const key in item) if (Object.prototype.hasOwnProperty.call(item, key)) {
          units += key.length;
          if (units > maxUnits) throw new Error('Structured output is too large to serialize.');
          pending.push((item as Record<string, unknown>)[key]);
        }
      }
    }
    if (units > maxUnits) throw new Error('Structured output is too large to serialize.');
  }
}
