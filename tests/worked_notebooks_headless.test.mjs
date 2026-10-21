import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertHeadlessPlan, ensureAccount, grantWorkedHardwarePermissions } from '../scripts/worked_notebooks.mjs';

test('background plan rejects actions that use external UI or sound', () => {
  for (const action of ['ai-visual-start', 'paste-owned-clipboard',
    'copy-owned-text-shortcut', 'play-test-tone']) {
    assert.throws(() => assertHeadlessPlan({ notebooks: [{ steps: [{ action }] }] }),
      new RegExp(action));
  }
  assert.doesNotThrow(() => assertHeadlessPlan({ notebooks: [{ steps: [
    { action: 'code' }, { action: 'ai' }, { action: 'click' },
  ] }] }));
});

test('background mode does not grant camera or microphone permissions', async () => {
  let grants = 0;
  const context = { grantPermissions: async () => { grants += 1; } };
  await grantWorkedHardwarePermissions(context, null, true);
  assert.equal(grants, 0);
  await grantWorkedHardwarePermissions(context, null, false);
  assert.equal(grants, 1);
});

test('background mode refuses an account needing visible sign-in', async () => {
  const previous = process.env.WORKED_HEADLESS;
  process.env.WORKED_HEADLESS = '1';
  let pageTouched = false;
  const page = { getByRole: () => { pageTouched = true; throw new Error('UI touched'); } };
  const request = { get: async () => ({ ok: () => true, json: async () => ({
    state: 'disconnected', configured: false, models: [],
  }) }) };
  try {
    await assert.rejects(() => ensureAccount(page, request), /requires an existing connected/);
    assert.equal(pageTouched, false);
  } finally {
    if (previous === undefined) delete process.env.WORKED_HEADLESS;
    else process.env.WORKED_HEADLESS = previous;
  }
});
