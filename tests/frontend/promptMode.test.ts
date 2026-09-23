import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promptMode, promptModeLabel } from '../../src/promptMode';

test('response style defaults to Compact and only accepts supported modes', () => {
  assert.equal(promptMode(undefined), 'compact');
  assert.equal(promptMode('compact'), 'compact');
  assert.equal(promptMode('full'), 'full');
  assert.equal(promptMode('learning'), 'learning');
  assert.equal(promptMode('verbose'), 'compact');
  assert.equal(promptModeLabel('learning'), 'Learning');
});
