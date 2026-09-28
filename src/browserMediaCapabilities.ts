/** Keep browser capability replies useful and valid within the model action budget. */
export interface BrowserCapabilityFact { available: boolean; reason?: string; formats?: string[] }

export function boundedCapabilityFacts(
  entries: Iterable<[string, BrowserCapabilityFact]>, maxChars = 2500
): { operations: Record<string, boolean>; details: Record<string, Omit<BrowserCapabilityFact, 'available'>>;
     omitted_details: number } {
  const facts = Array.from(entries);
  const operations: Record<string, boolean> = Object.fromEntries(facts.map(([name, fact]) => [name, fact.available === true]));
  const details: Record<string, Omit<BrowserCapabilityFact, 'available'>> = {};
  let omitted = 0;
  if (JSON.stringify({ operations, details, omitted_details: facts.length }).length > maxChars) {
    throw new Error('The browser operation registry exceeds the capability reply limit.');
  }
  for (const [name, item] of facts) {
    const detail: Omit<BrowserCapabilityFact, 'available'> = {};
    if (item.reason) detail.reason = item.reason.slice(0, 120);
    if (item.formats) detail.formats = item.formats.slice(0, 4).map(format => format.slice(0, 40));
    if (!detail.reason && !detail.formats) continue;
    const candidate = { ...details, [name]: detail };
    if (JSON.stringify({ operations, details: candidate, omitted_details: omitted }).length <= maxChars) {
      Object.assign(details, { [name]: detail });
    } else omitted += 1;
  }
  return { operations, details, omitted_details: omitted };
}
