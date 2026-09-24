import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subscriptionStatusText, subscriptionUsageText, SubscriptionStatus } from '../../src/subscriptionSetup';

const base: SubscriptionStatus = {
  state: 'signed_out', configured: false, models: [], file_access: 'project', usage: { state: 'unavailable' }
};

test('ChatGPT setup states use clear status without claiming a working connection', () => {
  assert.match(subscriptionStatusText(base), /Connect your ChatGPT account/);
  assert.match(subscriptionStatusText({ ...base, state: 'missing_runtime' }), /not installed/);
  assert.match(subscriptionStatusText({ ...base, state: 'incompatible_runtime' }), /not compatible/);
  assert.match(subscriptionStatusText({ ...base, state: 'installing' }), /in progress/);
  assert.match(subscriptionStatusText({ ...base, state: 'connecting' }), /Waiting/);
  assert.match(subscriptionStatusText({ ...base, state: 'expired' }), /expired/);
  assert.match(subscriptionStatusText({ ...base, state: 'limited' }), /limit reached/);
  assert.match(subscriptionStatusText({ ...base, state: 'offline' }), /offline/);
  assert.match(subscriptionStatusText({ ...base, state: 'error' }), /could not start/);
});

test('usage copy is account scoped and never promises API fallback', () => {
  assert.match(subscriptionUsageText({ state: 'available' }), /shared across your account/);
  assert.match(subscriptionUsageText({ state: 'unavailable' }), /unavailable/);
  assert.match(subscriptionUsageText({ state: 'limited', reset_at: 'tomorrow' }), /Resets tomorrow/);
  assert.match(subscriptionUsageText({ state: 'limited' }), /No automatic API fallback/);
  assert.match(subscriptionUsageText({ state: 'available', remaining_percent: 40 }), /40% remaining/);
  assert.doesNotMatch(subscriptionUsageText({ state: 'available', remaining_percent: -1 }), /remaining/);
});
