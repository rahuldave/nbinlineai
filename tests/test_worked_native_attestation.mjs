import assert from 'node:assert/strict';
import { test } from 'node:test';
import { acceptedNativeImage, noToolPlan } from '../scripts/worked_native_attestation.mjs';

const sha = 'b'.repeat(64);
const row = { kind: 'accepted_native_image_turn', input_count: 2,
  input_types: ['text', 'localImage'], local_image_count: 1, local_image_sha256: sha,
  turn_id: 'opaque-owned-turn' };

test('only a completed event stream with zero tool activity attests a no-tool answer', () => {
  assert.deepEqual(noToolPlan([{ type: 'text_delta', text: 'done' },
    { type: 'done', tool_steps: 0 }], 'q'),
  { questionCellId: 'q', source: 'owned_subscription_sse', toolSteps: 0, toolEvents: 0 });
  for (const events of [[{ type: 'done', tool_steps: 1 }],
    [{ type: 'done', tool_steps: 0 }, { type: 'tool_start' }],
    [{ type: 'done', tool_steps: 0 }, { type: 'frontend_action' }],
    [{ type: 'done', tool_steps: 0 }, { type: 'tool_result' }],
    [{ type: 'done', tool_steps: 0 }, { type: 'error' }],
    [{ type: 'done', tool_steps: 0 }, { type: 'done', tool_steps: 0 }]]) {
    assert.throws(() => noToolPlan(events, 'q'));
  }
});

test('only one new accepted image turn matching the exact hash attests this question', () => {
  const prior = [row];
  assert.deepEqual(acceptedNativeImage(prior, [...prior, row], 'q', sha),
    { questionCellId: 'q', source: 'accepted_turn_start', localImageCount: 1, sha256: sha });
  assert.throws(() => acceptedNativeImage(prior, prior, 'q', sha));
  assert.throws(() => acceptedNativeImage(prior, [...prior, row, row], 'q', sha));
  assert.throws(() => acceptedNativeImage(prior, [{ ...row, local_image_sha256: 'a'.repeat(64) }, row], 'q', sha));
  assert.throws(() => acceptedNativeImage([], [{ ...row, input_types: ['text', 'text'] }], 'q', sha));
  assert.throws(() => acceptedNativeImage([], [row], 'q', 'not-a-sha'));
});
