import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keepsCompletedAnswer } from '../../src/keepAnswer';

test('completed nonempty answers are protected by default and can be explicitly rerun', () => {
  const completed = { status: 'done', source: 'Result' };
  assert.equal(keepsCompletedAnswer(undefined, completed), true);
  assert.equal(keepsCompletedAnswer(true, completed), true);
  assert.equal(keepsCompletedAnswer(false, completed), false);
});

test('failed, cancelled, deleted, and empty answers remain retryable', () => {
  assert.equal(keepsCompletedAnswer(undefined, null), false);
  for (const status of ['running', 'error', 'cancelled']) {
    assert.equal(keepsCompletedAnswer(undefined, { status, source: 'Partial' }), false);
  }
  assert.equal(keepsCompletedAnswer(undefined, { status: 'done', source: '  ' }), false);
});
