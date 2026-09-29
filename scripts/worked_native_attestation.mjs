/** Safe evidence summaries derived from one owned subscription step. */
const SHA = /^[0-9a-f]{64}$/;
const TOOL_EVENTS = new Set(['tool_start', 'tool_result', 'frontend_action']);

export function noToolPlan(events, questionCellId) {
  const done = events.filter(event => event.type === 'done');
  const toolEvents = events.filter(event => TOOL_EVENTS.has(event.type));
  if (events.some(event => event.type === 'error') || done.length !== 1 ||
      done[0].tool_steps !== 0 || toolEvents.length !== 0) {
    throw new Error('Subscription turn was not a completed zero-tool turn');
  }
  return { questionCellId, source: 'owned_subscription_sse', toolSteps: 0, toolEvents: 0 };
}

export function acceptedNativeImage(before, after, questionCellId, expectedSha256) {
  if (!SHA.test(expectedSha256) || !Array.isArray(before) || !Array.isArray(after) ||
      JSON.stringify(after.slice(0, before.length)) !== JSON.stringify(before)) {
    throw new Error('Native image observer history changed');
  }
  const added = after.slice(before.length);
  if (added.length !== 1 || added[0].kind !== 'accepted_native_image_turn' ||
      added[0].input_count !== 2 || added[0].local_image_count !== 1 ||
      JSON.stringify(added[0].input_types) !== JSON.stringify(['text', 'localImage']) ||
      added[0].local_image_sha256 !== expectedSha256) {
    throw new Error('No matching accepted native image turn');
  }
  return { questionCellId, source: 'accepted_turn_start', localImageCount: 1,
    sha256: expectedSha256 };
}
