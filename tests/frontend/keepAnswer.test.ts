import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveKeepAnswer, keepsCompletedAnswer } from '../../src/keepAnswer';

test('cell setting inherits notebook Keep answers or explicitly overrides it', () => {
  assert.equal(effectiveKeepAnswer(undefined, undefined), true);
  assert.equal(effectiveKeepAnswer(undefined, false), false);
  assert.equal(effectiveKeepAnswer(true, false), true);
  assert.equal(effectiveKeepAnswer(false, true), false);
});

test('completed nonempty answers are protected by default and can be explicitly rerun', () => {
  const completed = { status: 'done', source: 'Result' };
  assert.equal(keepsCompletedAnswer(true, completed), true);
  assert.equal(keepsCompletedAnswer(false, completed), false);
});

test('failed, cancelled, deleted, and empty answers remain retryable', () => {
  assert.equal(keepsCompletedAnswer(true, null), false);
  for (const status of ['running', 'error', 'cancelled']) {
    assert.equal(keepsCompletedAnswer(true, { status, source: 'Partial' }), false);
  }
  assert.equal(keepsCompletedAnswer(true, { status: 'done', source: '  ' }), false);
});
